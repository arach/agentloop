import path from "node:path";
import { readdir } from "node:fs/promises";
import type { ServiceManager } from "../services/ServiceManager.js";

export type ToolName = "time.now" | "fs.read" | "fs.list" | "service.status";

export type ToolCallInput =
  | { name: "time.now"; args: Record<string, never> }
  | { name: "fs.read"; args: { path: string; maxBytes?: number } }
  | { name: "fs.list"; args: { path: string } }
  | { name: "service.status"; args: { name: "kokomo" | "mlx" | "vlm" } };

export type ToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export function toolSystemPrompt(repoRoot: string): string {
  return [
    "You may call tools when helpful. To call a tool, output a single line:",
    "TOOL_CALL: {\"name\":\"...\",\"args\":{...}}",
    "",
    "Available tools:",
    "- time.now args={} -> { iso, epochMs }",
    `- fs.read args={\"path\":\"<repo-relative>\",\"maxBytes\":65536} -> { path, bytes, content } (repo root: ${repoRoot})`,
    "- fs.list args={\"path\":\"<repo-relative>\"} -> { path, entries:[{name,type}] }",
    "- service.status args={\"name\":\"kokomo\"|\"mlx\"|\"vlm\"} -> ServiceState",
    "",
    "Rules:",
    "- Only use repo-relative paths for fs.* tools.",
    "- Call at most one tool at a time; wait for TOOL_RESULT in the next message before continuing.",
  ].join("\n");
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

export async function runTool(
  repoRoot: string,
  services: ServiceManager,
  call: ToolCallInput
): Promise<ToolResult> {
  try {
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

    return { ok: false, error: `unknown tool: ${(call as any).name}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

