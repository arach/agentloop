import path from "node:path";
import type { ToolName } from "../agent/tools.js";

export type AgentPack = {
  name: string;
  description: string;
  prompt: string;
  tools: ToolName[];
  maxToolCalls: number;
  maxHistoryTurns: number;
  temperature?: number;
};

const BUILT_IN_AGENTS: AgentPack[] = [
  {
    name: "chat.quick",
    description: "Fast, conversational replies (no tools).",
    prompt: [
      "You are in `chat.quick` mode.",
      "Answer directly and briefly. Do not plan unless asked.",
      "Do not call tools.",
    ].join("\n"),
    tools: [],
    maxToolCalls: 0,
    maxHistoryTurns: 10,
    temperature: 0.2,
  },
  {
    name: "debug.triage",
    description: "Debugging triage (ask for evidence, minimal changes).",
    prompt: [
      "You are in `debug.triage` mode.",
      "Ask for logs/errors/repro steps, then propose the smallest next action.",
      "Keep the conversation clean; details belong in logs.",
    ].join("\n"),
    tools: ["fs.read", "fs.list", "service.status"],
    maxToolCalls: 3,
    maxHistoryTurns: 20,
    temperature: 0.1,
  },
  {
    name: "code.arch",
    description: "Architecture discussion and planning (tools optional).",
    prompt: [
      "You are in `code.arch` mode.",
      "Focus on architecture, tradeoffs, and a clear plan.",
      "Avoid making changes unless explicitly asked.",
    ].join("\n"),
    tools: ["fs.read", "fs.list"],
    maxToolCalls: 2,
    maxHistoryTurns: 20,
    temperature: 0.2,
  },
  {
    name: "code.change",
    description: "Small, surgical code changes (tools enabled).",
    prompt: [
      "You are in `code.change` mode.",
      "Prefer small, focused patches and verify with typecheck if relevant.",
      "Avoid unrelated refactors and keep output concise.",
    ].join("\n"),
    tools: ["fs.read", "fs.list", "service.status", "logo.fetch"],
    maxToolCalls: 4,
    maxHistoryTurns: 30,
    temperature: 0.1,
  },
  {
    name: "tool.use",
    description: "Explicit tool loop for multi-step tasks.",
    prompt: [
      "You are in `tool.use` mode.",
      "Use tools when necessary; otherwise respond normally.",
      "Be deliberate: one tool call at a time, then proceed.",
    ].join("\n"),
    tools: ["time.now", "fs.read", "fs.list", "service.status", "logo.fetch"],
    maxToolCalls: 6,
    maxHistoryTurns: 30,
    temperature: 0.2,
  },
];

type ParsedFrontmatter = {
  name?: string;
  description?: string;
  tools?: string[];
  max_tool_calls?: number;
  max_history_turns?: number;
  temperature?: number;
};

function parseFrontmatterBlock(block: string): ParsedFrontmatter {
  const out: ParsedFrontmatter = {};
  const lines = block.split(/\r?\n/);
  let currentListKey: "tools" | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (currentListKey) {
      const m = trimmed.match(/^-+\s*(.+)\s*$/);
      if (m) {
        const v = m[1]?.trim();
        if (v) (out.tools ??= []).push(v);
        continue;
      }
      currentListKey = null;
    }

    const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)\s*$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2] ?? "";

    if (key === "tools") {
      currentListKey = "tools";
      if (value.trim()) {
        const parts = value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (parts.length) out.tools = parts;
        currentListKey = null;
      }
      continue;
    }

    if (key === "name") out.name = value.trim();
    else if (key === "description") out.description = value.trim();
    else if (key === "max_tool_calls") out.max_tool_calls = Number(value);
    else if (key === "max_history_turns") out.max_history_turns = Number(value);
    else if (key === "temperature") out.temperature = Number(value);
  }

  return out;
}

function parseAgentMarkdown(contents: string, fallbackName: string): { meta: ParsedFrontmatter; prompt: string } {
  const trimmed = contents.trimStart();
  if (!trimmed.startsWith("---\n") && !trimmed.startsWith("---\r\n")) {
    return { meta: { name: fallbackName }, prompt: contents.trim() };
  }

  const endIdx = trimmed.indexOf("\n---", 4);
  if (endIdx < 0) return { meta: { name: fallbackName }, prompt: contents.trim() };

  const header = trimmed.slice(4, endIdx).trim();
  const rest = trimmed.slice(endIdx + "\n---".length).replace(/^\r?\n/, "").trim();
  const meta = parseFrontmatterBlock(header);
  if (!meta.name) meta.name = fallbackName;
  return { meta, prompt: rest };
}

function toToolName(s: string): ToolName | null {
  if (s === "time.now") return "time.now";
  if (s === "fs.read") return "fs.read";
  if (s === "fs.list") return "fs.list";
  if (s === "service.status") return "service.status";
  if (s === "logo.fetch") return "logo.fetch";
  return null;
}

export async function loadAgentPacks(repoRoot: string): Promise<AgentPack[]> {
  const byName = new Map<string, AgentPack>();
  for (const a of BUILT_IN_AGENTS) byName.set(a.name, a);

  const dir = path.join(repoRoot, ".agentloop", "agents");
  const glob = new Bun.Glob("*.md");
  const files = await Array.fromAsync(glob.scan({ cwd: dir, onlyFiles: true })).catch(() => []);

  for (const rel of files) {
    const filePath = path.join(dir, rel);
    const base = path.basename(rel, ".md");
    const text = await Bun.file(filePath)
      .text()
      .catch(() => "");
    if (!text.trim()) continue;

    const parsed = parseAgentMarkdown(text, base);
    const name = (parsed.meta.name ?? base).trim();
    if (!name) continue;

    const tools = (parsed.meta.tools ?? [])
      .map(toToolName)
      .filter((t): t is ToolName => Boolean(t));
    const built = byName.get(name);

    byName.set(name, {
      name,
      description: parsed.meta.description?.trim() || built?.description || "Custom agent pack.",
      prompt: parsed.prompt.trim() || built?.prompt || "",
      tools: tools.length ? tools : built?.tools || [],
      maxToolCalls: Number.isFinite(parsed.meta.max_tool_calls ?? NaN) ? Number(parsed.meta.max_tool_calls) : built?.maxToolCalls ?? 3,
      maxHistoryTurns: Number.isFinite(parsed.meta.max_history_turns ?? NaN)
        ? Number(parsed.meta.max_history_turns)
        : built?.maxHistoryTurns ?? 20,
      temperature: Number.isFinite(parsed.meta.temperature ?? NaN) ? Number(parsed.meta.temperature) : built?.temperature,
    });
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}
