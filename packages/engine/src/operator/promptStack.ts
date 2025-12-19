import path from "node:path";
import type { Message } from "@agentloop/core";
import { CORE_SYSTEM_PROMPT } from "./corePrompt.js";
import type { AgentPack } from "./agentRegistry.js";

async function readOptionalText(filePath: string): Promise<string> {
  const f = Bun.file(filePath);
  if (!(await f.exists())) return "";
  return f.text().catch(() => "");
}

export async function loadWorkspacePrompt(repoRoot: string): Promise<string> {
  const shared = await readOptionalText(path.join(repoRoot, ".agentloop", "workspace.md"));
  const local = await readOptionalText(path.join(repoRoot, ".agentloop", "workspace.local.md"));
  return [shared.trim(), local.trim()].filter(Boolean).join("\n\n");
}

export function composeSystemPrompt(opts: {
  agent: AgentPack;
  workspacePrompt?: string;
  sessionPrompt?: string;
  includeCore?: boolean;
}): string {
  const parts: string[] = [];
  if (opts.includeCore !== false) parts.push(CORE_SYSTEM_PROMPT);
  if (opts.agent.prompt.trim()) parts.push(opts.agent.prompt.trim());
  if (opts.workspacePrompt?.trim()) parts.push(opts.workspacePrompt.trim());
  if (opts.sessionPrompt?.trim()) parts.push(opts.sessionPrompt.trim());
  return parts.filter(Boolean).join("\n\n");
}

export function buildChatMessages(opts: {
  system: string;
  sessionMessages: Message[];
  maxHistoryTurns: number;
}): { role: "system" | "user" | "assistant"; content: string }[] {
  const history = opts.sessionMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-Math.max(0, opts.maxHistoryTurns) * 2)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const sys = opts.system.trim();
  return [{ role: "system", content: sys }, ...history];
}

