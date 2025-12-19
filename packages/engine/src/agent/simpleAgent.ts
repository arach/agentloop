import path from "node:path";
import { fileURLToPath } from "node:url";
import { createId, type Message, type ToolCall } from "@agentloop/core";
import type { ServiceManager } from "../services/ServiceManager.js";
import { mlxChatCompletion } from "../llm/mlxClient.js";
import {
  formatToolResult,
  parseToolCallFromText,
  runTool,
  stripToolProtocol,
  toolSystemPrompt,
  type ToolCallInput,
  type ToolName,
} from "./tools.js";

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

export type AgentStepEvent =
  | { type: "tool.call"; tool: ToolCall }
  | { type: "tool.result"; toolId: string; result: unknown }
  | { type: "assistant.text"; content: string };

export async function runSimpleAgent(options: {
  sessionMessages: Message[];
  services: ServiceManager;
  maxToolCalls?: number;
  systemPrompt?: string;
  allowedTools?: ToolName[];
  onEvent?: (evt: AgentStepEvent) => void;
}): Promise<string> {
  const root = repoRoot();
  const maxToolCalls = options.maxToolCalls ?? 3;
  const sys = options.systemPrompt?.trim();

  const baseMessages = [
    ...(sys ? [{ role: "system" as const, content: sys }] : []),
    { role: "system" as const, content: toolSystemPrompt(root, options.allowedTools) },
    ...options.sessionMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-20)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  let messages = [...baseMessages];
  let lastAssistant = "";

  for (let i = 0; i < maxToolCalls + 1; i++) {
    const out = await mlxChatCompletion(messages);
    lastAssistant = out.content;

    const toolCall = parseToolCallFromText(lastAssistant);
    if (!toolCall) {
      const cleaned = stripToolProtocol(lastAssistant);
      options.onEvent?.({ type: "assistant.text", content: cleaned });
      return cleaned || "…";
    }

    const toolId = createId();
    const tool: ToolCall = {
      id: toolId,
      name: toolCall.name,
      args: toolCall.args as Record<string, unknown>,
      status: "running",
    };
    options.onEvent?.({ type: "tool.call", tool });

    const result = await runTool(root, options.services, toolCall as ToolCallInput, { allowedTools: options.allowedTools });
    options.onEvent?.({ type: "tool.result", toolId, result });

    // Feed the result back in as a system message.
    messages = [
      ...messages,
      { role: "assistant" as const, content: lastAssistant },
      { role: "system" as const, content: formatToolResult(toolCall.name, result) },
    ];
  }

  // If we somehow kept tool-calling forever, fall back to last assistant text.
  return stripToolProtocol(lastAssistant) || "No response.";
}
