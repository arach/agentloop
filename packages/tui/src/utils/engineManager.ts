import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type EngineStateFile = {
  host: string;
  port: number;
  pid: number;
  startedAt: number;
};

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isAgentLoopRoot(dir: string): boolean {
  const pj = join(dir, "package.json");
  if (!existsSync(pj)) return false;
  const parsed = safeJsonParse<{ name?: string; workspaces?: unknown }>(readFileSync(pj, "utf8"));
  if (!parsed) return false;
  if (parsed.name !== "agentloop") return false;
  const workspaces = parsed.workspaces;
  return Array.isArray(workspaces) && workspaces.includes("packages/*");
}

export function findRepoRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < 25; i++) {
    if (isAgentLoopRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

export function resolveEnginePaths(): {
  repoRoot: string;
  engineDir: string;
  runDir: string;
  stateFile: string;
} {
  const repoRoot =
    findRepoRoot(process.cwd()) ??
    findRepoRoot(import.meta.dir) ??
    (() => {
      throw new Error("Could not locate repo root (expected package.json name=agentloop).");
    })();

  const engineDir = join(repoRoot, "packages", "engine");
  const runDir = join(repoRoot, ".agentloop", "run");

  const stateOverride = process.env.AGENTLOOP_ENGINE_STATE_FILE?.trim();
  const stateFile = stateOverride
    ? isAbsolute(stateOverride)
      ? stateOverride
      : join(repoRoot, stateOverride)
    : join(runDir, "engine.json");

  return { repoRoot, engineDir, runDir, stateFile };
}

export async function readEngineStateFile(stateFile: string): Promise<EngineStateFile | null> {
  try {
    const txt = await readFile(stateFile, "utf8");
    const parsed = safeJsonParse<Partial<EngineStateFile>>(txt);
    if (!parsed) return null;
    if (!parsed.host || typeof parsed.host !== "string") return null;
    if (!Number.isFinite(parsed.port)) return null;
    if (!Number.isFinite(parsed.pid)) return null;
    if (!Number.isFinite(parsed.startedAt)) return null;
    return {
      host: parsed.host,
      port: Number(parsed.port),
      pid: Number(parsed.pid),
      startedAt: Number(parsed.startedAt),
    };
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForEngineStateFile(opts: {
  stateFile: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<EngineStateFile | null> {
  const timeoutMs = opts.timeoutMs ?? 6_000;
  const pollMs = opts.pollMs ?? 100;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readEngineStateFile(opts.stateFile);
    if (state && Number.isFinite(state.port) && state.port > 0) return state;
    await Bun.sleep(pollMs);
  }
  return null;
}

export function spawnManagedEngine(opts: { engineDir: string; stateFile: string; host: string }) {
  const bunExe = process.execPath;
  return Bun.spawn({
    cwd: opts.engineDir,
    cmd: [
      bunExe,
      "run",
      "start",
      "--",
      "--host",
      opts.host,
      "--random-port",
      "--state-file",
      opts.stateFile,
    ],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
}

export async function stopManagedEngine(opts: { stateFile: string }): Promise<{ ok: boolean; detail: string }> {
  const state = await readEngineStateFile(opts.stateFile);
  if (!state) return { ok: false, detail: "no state file" };
  if (!isPidAlive(state.pid)) {
    await rm(opts.stateFile, { force: true }).catch(() => {});
    return { ok: false, detail: "not running (stale state removed)" };
  }
  try {
    process.kill(state.pid, "SIGTERM");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `failed to send SIGTERM: ${msg}` };
  }
  await rm(opts.stateFile, { force: true }).catch(() => {});
  return { ok: true, detail: `stopped pid ${state.pid}` };
}

export async function ensureRunDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

