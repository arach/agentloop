#!/usr/bin/env bun
import { mkdir, writeFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

type Status = "pass" | "warn" | "fail";

type CheckResult = {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
};

async function runCmd(cmd: string[], timeoutMs = 4000): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, timeoutMs);
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      proc.stdout?.text() ?? Promise.resolve(""),
      proc.stderr?.text() ?? Promise.resolve(""),
    ]);
    clearTimeout(timer);
    return { code, stdout, stderr };
  } catch (err) {
    return { code: 127, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

async function checkBinary(
  label: string,
  cmd: string[],
  opts: { fix?: string; expectCode?: number; extract?: (stdout: string, stderr: string) => string } = {}
): Promise<CheckResult> {
  const { code, stdout, stderr } = await runCmd(cmd);
  const okCode = opts.expectCode ?? 0;
  if (code === okCode) {
    const info = opts.extract?.(stdout, stderr) ?? stdout.trim().split("\n")[0] ?? "";
    return { name: label, status: "pass", detail: info || "ok" };
  }
  return {
    name: label,
    status: "fail",
    detail: stderr.trim() || `exit ${code}`,
    fix: opts.fix,
  };
}

async function checkClipboard(): Promise<CheckResult> {
  const platform = process.platform;
  const candidates =
    platform === "darwin"
      ? ["pbcopy", "/usr/bin/pbcopy"]
      : platform === "linux"
        ? ["wl-copy", "/usr/bin/wl-copy", "xclip", "/usr/bin/xclip", "xsel", "/usr/bin/xsel"]
        : platform === "win32"
          ? ["clip"]
          : [];
  for (const c of candidates) {
    const { code } = await runCmd([c, "--help"]);
    if (code === 0) return { name: "clipboard", status: "pass", detail: c };
  }
  return {
    name: "clipboard",
    status: "warn",
    detail: "No clipboard tool detected",
    fix: platform === "darwin" ? "Ensure pbcopy is available (Xcode CLI tools)" : "Install wl-copy/xclip/xsel",
  };
}

async function checkAudio(): Promise<CheckResult> {
  const candidates = process.platform === "darwin" ? ["afplay"] : ["ffplay", "aplay"];
  for (const c of candidates) {
    const { code } = await runCmd([c, "-h"]);
    if (code === 0) return { name: "audio", status: "pass", detail: c };
  }
  return {
    name: "audio",
    status: "warn",
    detail: "No audio playback tool detected",
    fix: process.platform === "darwin" ? "Install Xcode CLI tools for afplay" : "Install ffmpeg (ffplay) or aplay",
  };
}

async function checkPort(port: number): Promise<CheckResult> {
  try {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", (err) => {
        server.close();
        reject(err);
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve());
      });
    });
    return { name: `port:${port}`, status: "pass", detail: "available" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: `port:${port}`,
      status: "warn",
      detail: `in use (${msg})`,
      fix: "Use --port 0 for random port or stop the blocking process.",
    };
  } finally {
    // nothing to clean up; server is closed in promise handler
  }
}

async function checkWritable(dir: string): Promise<CheckResult> {
  try {
    await mkdir(dir, { recursive: true });
    const p = path.join(dir, `.doctor-${Date.now()}.tmp`);
    await writeFile(p, "ok");
    await rm(p);
    return { name: `writable:${dir}`, status: "pass", detail: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: `writable:${dir}`,
      status: "fail",
      detail: msg,
      fix: "Ensure directory exists and is writable (chmod/chown).",
    };
  }
}

function printHuman(results: CheckResult[]): void {
  const icon = (s: Status) => (s === "pass" ? "✅" : s === "warn" ? "⚠️" : "❌");
  for (const r of results) {
    const parts = [`${icon(r.status)} ${r.name}: ${r.detail}`];
    if (r.fix) parts.push(`   fix: ${r.fix}`);
    console.log(parts.join("\n"));
  }
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  console.log();
  console.log(`Summary: ${results.length} checks • ${fails} fail • ${warns} warn`);
}

export async function run(): Promise<number> {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");

  const checks: Promise<CheckResult>[] = [
    checkBinary("bun", ["bun", "--version"], { fix: "Install Bun: https://bun.sh", extract: (out) => out.trim() }),
    checkBinary("python3", ["python3", "--version"], { fix: "Install Python 3 and ensure python3 is in PATH" }),
    checkBinary("uv", ["uv", "--version"], {
      fix: "Install uv: https://github.com/astral-sh/uv (required by installers)",
    }),
    checkClipboard(),
    checkAudio(),
    checkPort(7777),
    checkWritable(".agentloop"),
    checkWritable("external"),
  ];

  const results = await Promise.all(checks);
  const ok = results.every((r) => r.status === "pass") || results.every((r) => r.status !== "fail");
  if (json) {
    console.log(JSON.stringify({ ok, results }, null, 2));
  } else {
    printHuman(results);
  }
  return ok ? 0 : 1;
}

if (import.meta.main) {
  run().then(
    (code) => process.exit(code),
    (err) => {
      console.error("doctor failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  );
}
