import type { ToolName } from "../agent/tools.js";
import type { AgentPack } from "./agentRegistry.js";

export type RoutingDecision = {
  agent: string;
  toolsAllowed: ToolName[];
  reason: string;
};

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

export function routeHeuristic(message: string, agents: AgentPack[]): RoutingDecision {
  const text = message.trim().toLowerCase();
  const get = (name: string) => agents.find((a) => a.name === name) ?? agents[0]!;
  const pick = (name: string, reason: string): RoutingDecision => {
    const a = get(name);
    return { agent: a.name, toolsAllowed: a.tools, reason };
  };

  if (!text) return pick("chat.quick", "empty");

  // Debug signals
  if (
    hasAny(text, [
      "stack trace",
      "traceback",
      "exception",
      "panic",
      "segfault",
      "hang",
      "stuck",
      "timeout",
      "not working",
      "doesn't work",
      "error:",
      "failed",
    ])
  ) {
    return pick("debug.triage", "debug_keywords");
  }

  // Architecture/planning signals
  if (hasAny(text, ["architecture", "design", "tradeoffs", "roadmap", "plan", "milestones", "spec", "strategy"])) {
    return pick("code.arch", "arch_keywords");
  }

  // Code change signals
  if (
    hasAny(text, ["implement", "refactor", "fix", "add", "remove", "rename", "update", "change"]) &&
    hasAny(text, ["file", "repo", "package", "function", "type", "test", "tui", "engine", "docs", "readme"])
  ) {
    return pick("code.change", "edit_keywords");
  }

  // Default: quick chat.
  return pick("chat.quick", "default");
}

