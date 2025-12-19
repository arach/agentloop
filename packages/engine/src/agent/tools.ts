import path from "node:path";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import type { ServiceManager } from "../services/ServiceManager.js";

export type ToolName = "time.now" | "fs.read" | "fs.list" | "service.status" | "logo.fetch";

export type ToolCallInput =
  | { name: "time.now"; args: Record<string, never> }
  | { name: "fs.read"; args: { path: string; maxBytes?: number } }
  | { name: "fs.list"; args: { path: string } }
  | { name: "service.status"; args: { name: "kokomo" | "mlx" | "vlm" } }
  | { name: "logo.fetch"; args: { domain?: string; brand?: string } };

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export function toolSystemPrompt(repoRoot: string, allowedTools?: ToolName[]): string {
  const allow = new Set<ToolName>(allowedTools ?? ["time.now", "fs.read", "fs.list", "service.status", "logo.fetch"]);
  const lines: string[] = [
    "You may call tools when helpful. To call a tool, output a single line:",
    "TOOL_CALL: {\"name\":\"...\",\"args\":{...}}",
    "",
    "Available tools:",
  ];

  if (allow.has("time.now")) lines.push("- time.now args={} -> { iso, epochMs }");
  if (allow.has("fs.read"))
    lines.push(
      `- fs.read args={\"path\":\"<repo-relative>\",\"maxBytes\":65536} -> { path, bytes, content } (repo root: ${repoRoot})`
    );
  if (allow.has("fs.list")) lines.push("- fs.list args={\"path\":\"<repo-relative>\"} -> { path, entries:[{name,type}] }");
  if (allow.has("service.status")) lines.push("- service.status args={\"name\":\"kokomo\"|\"mlx\"|\"vlm\"} -> ServiceState");
  if (allow.has("logo.fetch"))
    lines.push("- logo.fetch args={\"domain\":\"example.com\"} -> { domain, url, filePath, bytes } (downloads logo PNG to local cache)");

  lines.push(
    "",
    "Rules:",
    "- Only use repo-relative paths for fs.* tools.",
    "- Call at most one tool at a time; wait for TOOL_RESULT in the next message before continuing.",
    "- Never output TOOL_RESULT yourself. The system will provide it.",
    "- Do not include TOOL_CALL or TOOL_RESULT in your final user-facing answer."
  );

  return lines.join("\n");
}

export function isToolAllowed(name: ToolName, allowedTools?: ToolName[]): boolean {
  if (!allowedTools) return true;
  return allowedTools.includes(name);
}

export function toolNotAllowedResult(name: ToolName): ToolResult {
  return { ok: false, error: `tool not allowed: ${name}` };
}

export function stripToolProtocol(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("TOOL_CALL:")) continue;
    if (trimmed.startsWith("TOOL_RESULT:")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

export function parseToolCallFromText(text: string): ToolCallInput | null {
  const lines = text.split(/\r?\n/);
  const line = lines.find((l) => l.trimStart().startsWith("TOOL_CALL:"));
  if (!line) return null;
  const jsonPart = line.slice(line.indexOf("TOOL_CALL:") + "TOOL_CALL:".length).trim();
  try {
    const parsed = JSON.parse(jsonPart) as { name?: unknown; args?: unknown };
    if (!parsed || typeof parsed !== "object") return null;
    const name = parsed.name;
    const args = parsed.args;
    if (name === "time.now" && (args == null || typeof args === "object")) return { name, args: {} };
    if (name === "fs.read" && args && typeof args === "object") {
      const p = (args as any).path;
      const maxBytes = (args as any).maxBytes;
      if (typeof p !== "string") return null;
      if (maxBytes != null && !(typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0)) return null;
      return { name, args: { path: p, maxBytes } };
    }
    if (name === "fs.list" && args && typeof args === "object") {
      const p = (args as any).path;
      if (typeof p !== "string") return null;
      return { name, args: { path: p } };
    }
    if (name === "service.status" && args && typeof args === "object") {
      const n = (args as any).name;
      if (n !== "kokomo" && n !== "mlx" && n !== "vlm") return null;
      return { name, args: { name: n } };
    }
    if (name === "logo.fetch" && args && typeof args === "object") {
      const domain = (args as any).domain;
      const brand = (args as any).brand;
      if (typeof domain !== "string" && typeof brand !== "string") return null;
      const picked = typeof domain === "string" ? domain : brand;
      return { name, args: { domain: picked, brand } };
    }
    return null;
  } catch {
    return null;
  }
}

export function formatToolResult(name: ToolName, result: ToolResult): string {
  return `TOOL_RESULT: ${JSON.stringify({ name, ...result })}`;
}

function ensureRepoRelative(repoRoot: string, p: string): string {
  if (!p || typeof p !== "string") throw new Error("path is required");
  if (path.isAbsolute(p)) throw new Error("absolute paths are not allowed");
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    throw new Error("path traversal is not allowed");
  }
  const full = path.resolve(repoRoot, normalized);
  const rel = path.relative(repoRoot, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("path escapes repo root");
  return full;
}

async function fetchLogoToFile(cacheDir: string, domain: string): Promise<{ filePath: string; urlTried: string; bytes: number }> {
  const clean = domain.toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) throw new Error("invalid domain");
  await mkdir(cacheDir, { recursive: true });
  const target = path.join(cacheDir, `${clean.replace(/[^a-z0-9.-]/gi, "_")}.png`);

  // Cache hit
  try {
    const existing = Bun.file(target);
    if (await existing.exists()) {
      const size = (await existing.arrayBuffer()).byteLength;
      return { filePath: target, urlTried: "", bytes: size };
    }
  } catch {
    // ignore cache miss
  }

  const url = `https://logo.clearbit.com/${clean}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty response");
  await writeFile(target, buf);
  return { filePath: target, urlTried: url, bytes: buf.byteLength };
}

export async function runTool(
  repoRoot: string,
  services: ServiceManager,
  call: ToolCallInput,
  opts?: { allowedTools?: ToolName[] }
): Promise<ToolResult> {
  try {
    if (!isToolAllowed(call.name, opts?.allowedTools)) {
      return toolNotAllowedResult(call.name);
    }

    if (call.name === "time.now") {
      return { ok: true, result: { iso: new Date().toISOString(), epochMs: Date.now() } };
    }

    if (call.name === "service.status") {
      return { ok: true, result: services.getState(call.args.name) };
    }

    if (call.name === "fs.list") {
      const full = ensureRepoRelative(repoRoot, call.args.path);
      const entries = await readdir(full, { withFileTypes: true });
      return {
        ok: true,
        result: {
          path: call.args.path,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
          })),
        },
      };
    }

    if (call.name === "fs.read") {
      const full = ensureRepoRelative(repoRoot, call.args.path);
      const maxBytes = call.args.maxBytes ?? 65_536;
      const file = Bun.file(full);
      if (!(await file.exists())) throw new Error("file does not exist");
      const buf = new Uint8Array(await file.arrayBuffer());
      const clipped = buf.slice(0, Math.min(buf.length, maxBytes));
      const content = new TextDecoder().decode(clipped);
      return { ok: true, result: { path: call.args.path, bytes: buf.length, content } };
    }

    if (call.name === "logo.fetch") {
      const domain = (call.args.domain ?? call.args.brand ?? "").toLowerCase().trim();
      if (!domain) throw new Error("domain is required");
      const cacheDir = path.join(repoRoot, ".agentloop", "cache", "logos");
      const { filePath, urlTried, bytes } = await fetchLogoToFile(cacheDir, domain);
      return { ok: true, result: { domain, url: urlTried || `https://logo.clearbit.com/${domain}`, filePath, bytes } };
    }

    return { ok: false, error: `unknown tool: ${(call as any).name}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
