#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CommandSchema,
  createId,
  type Command,
  type EngineEvent,
  type Session,
  type Message,
  type ServiceName,
} from "@agentloop/core";
import { parseEngineCli } from "./cli.js";
import { ServiceManager } from "./services/ServiceManager.js";
import { runSimpleAgent } from "./agent/simpleAgent.js";
import { mlxChatCompletion, mlxChatCompletionStream } from "./llm/mlxClient.js";
import { vlmChatCompletion } from "./llm/vlmClient.js";
import type { AgentPack } from "./operator/agentRegistry.js";
import { loadAgentPacks } from "./operator/agentRegistry.js";
import { buildChatMessages, composeSystemPrompt, loadWorkspacePrompt } from "./operator/promptStack.js";
import { routeHeuristic } from "./operator/router.js";
import { envNumber, envString } from "./utils/env.js";

function isSimpleMessage(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("TOOL_CALL:")) return false;
  // Heuristic: short, single-turn chat is "simple".
  return trimmed.length <= 220 && trimmed.split(/\s+/).length <= 60;
}

function parseWorkbenchStrategies(raw: string | undefined): Array<WorkbenchStrategy["id"]> {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "0" || trimmed === "false") return [];
  if (trimmed === "1" || trimmed === "true") return ["quick", "balanced", "full"];
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  const allowed = new Set<WorkbenchStrategy["id"]>(["quick", "balanced", "full"]);
  return parts.filter((p): p is WorkbenchStrategy["id"] => allowed.has(p as WorkbenchStrategy["id"]));
}

function buildWorkbenchStrategies(): WorkbenchStrategy[] {
  const quickModel = envString("AGENTLOOP_MLX_MODEL_QUICK") ?? "mlx-community/Llama-3.2-1B-Instruct-4bit";
  const baseModel =
    envString("AGENTLOOP_MLX_MODEL") ?? envString("MLX_MODEL") ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";
  const quickMaxTokens = envNumber("AGENTLOOP_MLX_MAX_TOKENS_QUICK") ?? 128;
  const quickTemp = envNumber("AGENTLOOP_MLX_TEMPERATURE_QUICK") ?? 0.2;
  const balancedMaxTokens = envNumber("AGENTLOOP_MLX_MAX_TOKENS_BALANCED") ?? Math.min(192, envNumber("AGENTLOOP_MLX_MAX_TOKENS") ?? 256);
  const balancedTemp = envNumber("AGENTLOOP_MLX_TEMPERATURE_BALANCED") ?? 0.2;
  const fullMaxTokens = envNumber("AGENTLOOP_MLX_MAX_TOKENS") ?? 256;
  const fullTemp = envNumber("AGENTLOOP_MLX_TEMPERATURE") ?? 0.2;

  return [
    { id: "quick", model: quickModel, maxTokens: quickMaxTokens, temperature: quickTemp, maxHistoryTurns: 4 },
    { id: "balanced", model: baseModel, maxTokens: balancedMaxTokens, temperature: balancedTemp, maxHistoryTurns: 8 },
    { id: "full", model: baseModel, maxTokens: fullMaxTokens, temperature: fullTemp, maxHistoryTurns: 12 },
  ];
}

function normalizeForCompare(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccardSimilarity(a: string, b: string): number {
  const aTokens = normalizeForCompare(a);
  const bTokens = normalizeForCompare(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const setA = new Set(aTokens);
  const setB = new Set(bTokens);
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union ? intersection / union : 0;
}

function lengthRatio(a: string, b: string): number {
  const lenA = a.trim().length;
  const lenB = b.trim().length;
  if (!lenA || !lenB) return 0;
  return Math.min(lenA, lenB) / Math.max(lenA, lenB);
}

const QUICK_OUTPUT_GUIDANCE = [
  "Respond in plain text only.",
  "Never emit tool-call syntax or special tokens.",
  "Assume benign intent; avoid refusals unless unsafe.",
  "If you must refuse, keep it to one short sentence.",
  "Keep it brief unless explicitly asked for more.",
].join("\n");

const QUICK_OUTPUT_BLOCKERS = [
  "<start_function_call>",
  "<tool_call>",
  "<|tool_call|>",
  "TOOL_CALL:",
];

const QUICK_OUTPUT_STRIP_TOKENS = [
  "<end_of_turn>",
  "<start_of_turn>",
  "<eos>",
  "<|endoftext|>",
];

function sanitizeQuickOutput(text: string): string {
  let out = text;
  let cutIdx = -1;
  for (const marker of QUICK_OUTPUT_BLOCKERS) {
    const idx = out.indexOf(marker);
    if (idx >= 0 && (cutIdx === -1 || idx < cutIdx)) cutIdx = idx;
  }
  if (cutIdx >= 0) out = out.slice(0, cutIdx);
  for (const token of QUICK_OUTPUT_STRIP_TOKENS) {
    if (out.includes(token)) out = out.split(token).join("");
  }
  const trimmed = out.trim();
  return trimmed || text.trim();
}

function scrubQuickToken(token: string): { text: string; stop: boolean } {
  let out = token;
  let stop = false;
  let cutIdx = -1;
  for (const marker of QUICK_OUTPUT_BLOCKERS) {
    const idx = out.indexOf(marker);
    if (idx >= 0 && (cutIdx === -1 || idx < cutIdx)) cutIdx = idx;
  }
  if (cutIdx >= 0) {
    out = out.slice(0, cutIdx);
    stop = true;
  }
  for (const token of QUICK_OUTPUT_STRIP_TOKENS) {
    if (out.includes(token)) out = out.split(token).join("");
  }
  return { text: out, stop };
}

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

function loadEnvFile(): void {
  const envPath = process.env.AGENTLOOP_ENV_FILE ?? path.join(repoRoot(), ".agentloop", "env");
  if (!existsSync(envPath)) return;
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (!key || key.includes(" ")) continue;
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore env file errors; explicit env vars take precedence.
  }
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

async function imagePathToDataUrl(filePath: string): Promise<{ url: string; bytes: number; mime: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) throw new Error(`unsupported image type: ${ext || "unknown"}`);
  const buf = await readFile(filePath);
  if (!buf.length) throw new Error("empty image file");
  const b64 = Buffer.from(buf).toString("base64");
  return { url: `data:${mime};base64,${b64}`, bytes: buf.length, mime };
}

loadEnvFile();

const cli = (() => {
  try {
    return parseEngineCli(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
})();

if (cli.help) process.exit(0);
if (cli.kokomoLocal) process.env.AGENTLOOP_KOKOMO_LOCAL = "1";

type WorkbenchStrategy = {
  id: "quick" | "balanced" | "full";
  model: string;
  maxTokens: number;
  temperature: number;
  maxHistoryTurns: number;
};

// In-memory session store
const sessions = new Map<string, Session>();

function createSession(id: string): Session {
  return {
    id,
    status: "idle",
    messages: [],
    toolCalls: [],
    createdAt: Date.now(),
    routingMode: "auto",
  };
}

function sendEvent(ws: Bun.ServerWebSocket<unknown>, event: EngineEvent) {
  ws.send(JSON.stringify(event));
}

function sendPerf(
  ws: Bun.ServerWebSocket<unknown>,
  payload: { sessionId?: string; name: string; durationMs: number; meta?: Record<string, unknown> }
) {
  sendEvent(ws, { type: "perf.metric", ...payload });
}

const clients = new Set<Bun.ServerWebSocket<unknown>>();
function broadcastEvent(event: EngineEvent) {
  const payload = JSON.stringify(event);
  for (const ws of clients) ws.send(payload);
}

async function handleSessionCreate(ws: Bun.ServerWebSocket<unknown>, sessionId?: string) {
  const id = sessionId ?? createId();
  const session = createSession(id);
  sessions.set(id, session);

  sendEvent(ws, { type: "session.created", sessionId: id });
  sendEvent(ws, { type: "session.status", sessionId: id, status: "idle", detail: "Session ready" });
}

let cachedAgents: AgentPack[] | null = null;
let cachedWorkspacePrompt: string | null = null;
let lastPromptLoadAt = 0;
async function getAgentsAndWorkspace(): Promise<{ agents: AgentPack[]; workspacePrompt: string }> {
  const now = Date.now();
  const root = repoRoot();
  if (!cachedAgents || cachedWorkspacePrompt == null || now - lastPromptLoadAt > 2000) {
    const [agents, workspacePrompt] = await Promise.all([loadAgentPacks(root), loadWorkspacePrompt(root)]);
    cachedAgents = agents;
    cachedWorkspacePrompt = workspacePrompt;
    lastPromptLoadAt = now;
  }
  return { agents: cachedAgents, workspacePrompt: cachedWorkspacePrompt ?? "" };
}

async function handleSessionConfigure(
  ws: Bun.ServerWebSocket<unknown>,
  sessionId: string,
  payload: { routingMode?: "auto" | "pinned"; agent?: string | null; sessionPrompt?: string | null }
) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
    sessions.set(sessionId, session);
  }

  if (payload.routingMode) session.routingMode = payload.routingMode;
  if (payload.agent !== undefined) session.agent = payload.agent ?? undefined;
  if (payload.sessionPrompt !== undefined) session.sessionPrompt = payload.sessionPrompt ?? undefined;

  sendEvent(ws, {
    type: "session.status",
    sessionId,
    status: session.status,
    detail: `Configured (${session.routingMode}${session.agent ? `: ${session.agent}` : ""})`,
  });
}

async function handleAgentList(ws: Bun.ServerWebSocket<unknown>) {
  const { agents } = await getAgentsAndWorkspace();
  sendEvent(ws, {
    type: "agent.list",
    agents: agents.map((a) => ({ name: a.name, description: a.description, tools: a.tools })),
  });
}

async function handleSessionSend(
  ws: Bun.ServerWebSocket<unknown>,
  sessionId: string,
  content: string,
  images?: string[]
) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
    sessions.set(sessionId, session);
  }

  // Add user message
  const imagePaths = (images ?? []).filter(Boolean);
  const attachmentLines = imagePaths
    .map((img) => `[image] ${path.basename(img)}`)
    .filter(Boolean)
    .join("\n");
  const userMessage: Message = {
    id: createId(),
    role: "user",
    content: `${content}${attachmentLines ? `\n${attachmentLines}` : ""}`.trim(),
    timestamp: Date.now(),
  };
  session.messages.push(userMessage);
  session.status = "thinking";

  const workbenchIds = parseWorkbenchStrategies(process.env.AGENTLOOP_WORKBENCH);
  let responseText = "";
  let alreadyStreamed = false;
  let forceResponse: string | null = null;
  let imageInputs: { path: string; url: string; bytes: number; mime: string }[] = [];
  let quickFollowup:
    | {
        system: string;
        agent: AgentPack;
      }
    | null = null;
  let workbenchPlan:
    | {
        system: string;
        agent: AgentPack;
        primaryResponse: string;
        primaryModel: string;
        messages: Message[];
      }
    | null = null;

  if (imagePaths.length > 0) {
    try {
      imageInputs = await Promise.all(
        imagePaths.map(async (img) => {
          const { url, bytes, mime } = await imagePathToDataUrl(img);
          return { path: img, url, bytes, mime };
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      forceResponse = `Image attachment failed: ${msg}`;
    }
  }

  const hasImages = imageInputs.length > 0;
  if (hasImages) {
    const canAutoTryVlm = services.canStart("vlm") || (await services.isServiceHealthy("vlm"));
    if (canAutoTryVlm && services.getState("vlm").status !== "running") {
      try {
        await services.start("vlm");
      } catch {
        // ignore; we'll fall back below
      }
    }
    const vlmHealthy = await services.isServiceHealthy("vlm");
    const useVlm = services.getState("vlm").status === "running" || vlmHealthy;

    if (!useVlm) {
      forceResponse = [
        "Image input requires the VLM service.",
        "",
        "Fix:",
        "  bun run vlm:install -- --yes",
        "  bun run vlm:server",
        "",
        "Or from the TUI:",
        "  /install vlm --yes",
        "  /service vlm start",
      ].join("\n");
    } else {
      try {
        session.status = "streaming";
        sendEvent(ws, { type: "session.status", sessionId, status: "streaming", detail: "Vision (vlm)..." });

        const { agents, workspacePrompt } = await getAgentsAndWorkspace();
        const defaultAgent = agents.find((a) => a.name === "chat.quick") ?? agents[0]!;
        const extraSys = process.env.AGENTLOOP_SYSTEM_PROMPT?.trim();
        const system = [composeSystemPrompt({ agent: defaultAgent, workspacePrompt, sessionPrompt: session.sessionPrompt }), extraSys]
          .filter(Boolean)
          .join("\n\n");

        const prompt = content.trim() || "Describe the image.";
        const contentBlocks = [
          { type: "text" as const, text: prompt },
          ...imageInputs.map((img) => ({ type: "image_url" as const, image_url: { url: img.url } })),
        ];

        const llmStart = Date.now();
        const out = await vlmChatCompletion([
          ...(system ? [{ role: "system" as const, content: system }] : []),
          { role: "user" as const, content: contentBlocks },
        ]);
        responseText = out.content;
        sendPerf(ws, {
          sessionId,
          name: "llm.total",
          durationMs: Date.now() - llmStart,
          meta: { mode: "vlm", model: out.model, images: imageInputs.length },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        forceResponse = `VLM request failed: ${msg}`;
      }
    }
  }

  if (!hasImages && !forceResponse) {
    const prefersMlx = (process.env.AGENTLOOP_LLM ?? "").toLowerCase() === "mlx";
    const canAutoTryMlx = prefersMlx || services.canStart("mlx") || (await services.isServiceHealthy("mlx"));
    if (canAutoTryMlx && services.getState("mlx").status !== "running") {
      // Best-effort: if MLX is installed (or already serving externally), bring it up automatically.
      try {
        await services.start("mlx");
      } catch {
        // ignore; we'll fall back below
      }
    }
    const mlxHealthy = await services.isServiceHealthy("mlx");
    const useMlx = prefersMlx || services.getState("mlx").status === "running" || mlxHealthy;

    if (useMlx) {
      try {
        const startRouteAt = Date.now();
        const { agents, workspacePrompt } = await getAgentsAndWorkspace();
        const routingMode = session.routingMode ?? "auto";
        const pinnedName = routingMode === "pinned" ? (session.agent ?? "").trim() : "";
        const pinnedAgent = pinnedName ? agents.find((a) => a.name === pinnedName) : null;
        const decision = pinnedAgent
          ? { agent: pinnedAgent.name, toolsAllowed: pinnedAgent.tools, reason: "pinned" }
          : routeHeuristic(content, agents);
        const selected = agents.find((a) => a.name === decision.agent) ?? agents.find((a) => a.name === "chat.quick") ?? agents[0]!;

        sendEvent(ws, {
          type: "router.decision",
          sessionId,
          routingMode: pinnedAgent ? "pinned" : "auto",
          agent: selected.name,
          toolsAllowed: selected.tools,
          reason: decision.reason,
          durationMs: Date.now() - startRouteAt,
        });

        const extraSys = process.env.AGENTLOOP_SYSTEM_PROMPT?.trim();
        const system = [composeSystemPrompt({ agent: selected, workspacePrompt, sessionPrompt: session.sessionPrompt }), extraSys]
          .filter(Boolean)
          .join("\n\n");

        const shouldUseQuick = selected.name === "chat.quick" || (selected.tools.length === 0 && isSimpleMessage(content));
        if (shouldUseQuick) {
          session.status = "streaming";
          sendEvent(ws, { type: "session.status", sessionId, status: "streaming", detail: `Local LLM (${selected.name})...` });
          const quickSystem = [system, QUICK_OUTPUT_GUIDANCE].filter(Boolean).join("\n\n");
          const messages = buildChatMessages({ system: quickSystem, sessionMessages: session.messages, maxHistoryTurns: selected.maxHistoryTurns });
          alreadyStreamed = true;
          const llmStart = Date.now();
          let tokenCount = 0;
          let ttfbSent = false;
          let streamBlocked = false;
          const quickModel =
            envString("AGENTLOOP_MLX_MODEL_QUICK") ??
            envString("AGENTLOOP_MLX_MODEL") ??
            envString("MLX_MODEL") ??
            "mlx-community/Llama-3.2-1B-Instruct-4bit";
          const quickMaxTokens = envNumber("AGENTLOOP_MLX_MAX_TOKENS_QUICK") ?? 128;
          const quickTemp = envNumber("AGENTLOOP_MLX_TEMPERATURE_QUICK") ?? selected.temperature ?? 0.2;
          const quickBaseUrl = envString("AGENTLOOP_MLX_URL_QUICK") ?? envString("AGENTLOOP_MLX_URL");
          const streamed = await mlxChatCompletionStream(
            messages,
            (token) => {
              if (streamBlocked) return;
              const scrubbed = scrubQuickToken(token);
              if (scrubbed.text) {
                tokenCount += 1;
                if (!ttfbSent) {
                  ttfbSent = true;
                  sendPerf(ws, {
                    sessionId,
                    name: "llm.ttfb",
                    durationMs: Date.now() - llmStart,
                    meta: { agent: selected.name, mode: "stream" },
                  });
                }
                sendEvent(ws, { type: "assistant.token", sessionId, token: scrubbed.text });
              }
              if (scrubbed.stop) streamBlocked = true;
              return;
            },
            { maxTokens: quickMaxTokens, model: quickModel, temperature: quickTemp, baseUrl: quickBaseUrl }
          );
          responseText = sanitizeQuickOutput(streamed.content);
          sendPerf(ws, {
            sessionId,
            name: "llm.total",
            durationMs: Date.now() - llmStart,
            meta: { agent: selected.name, mode: "stream", tokens: tokenCount, model: streamed.model },
          });
          if (workbenchIds.length > 0) {
            workbenchPlan = {
              system: quickSystem,
              agent: selected,
              primaryResponse: responseText,
              primaryModel: streamed.model,
              messages: session.messages.slice(),
            };
          }
          const followupEnabled = process.env.AGENTLOOP_QUICK_FOLLOWUP !== "0";
          const followupMinChars = envNumber("AGENTLOOP_QUICK_FOLLOWUP_MIN_CHARS") ?? 140;
          const followupMinPromptChars = envNumber("AGENTLOOP_QUICK_FOLLOWUP_MIN_PROMPT_CHARS") ?? 12;
          const promptChars = content.trim().length;
          if (
            selected.name === "chat.quick" &&
            followupEnabled &&
            promptChars >= followupMinPromptChars &&
            responseText.trim().length < followupMinChars
          ) {
            quickFollowup = { system: quickSystem, agent: selected };
          }
        } else {
          session.status = "tool_use";
          sendEvent(ws, { type: "session.status", sessionId, status: "tool_use", detail: `Agent (${selected.name})...` });

          const agentStart = Date.now();
          responseText = await runSimpleAgent({
            sessionMessages: session.messages,
            services,
            systemPrompt: system,
            maxToolCalls: selected.maxToolCalls,
            allowedTools: selected.tools,
            onEvent: (evt) => {
              if (evt.type === "tool.call") {
                session.toolCalls.push(evt.tool);
                sendEvent(ws, { type: "tool.call", sessionId, tool: evt.tool });
              } else if (evt.type === "tool.result") {
                const t = session.toolCalls.find((x) => x.id === evt.toolId);
                if (t) {
                  t.status = (evt.result as any)?.ok ? "completed" : "failed";
                  t.result = evt.result;
                }
                sendEvent(ws, { type: "tool.result", sessionId, toolId: evt.toolId, result: evt.result });
              }
            },
            onPerf: (perf) => {
              sendPerf(ws, {
                sessionId,
                name: perf.name,
                durationMs: perf.durationMs,
                meta: { agent: selected.name, ...perf.meta },
              });
            },
          });
          sendPerf(ws, {
            sessionId,
            name: "agent.total",
            durationMs: Date.now() - agentStart,
            meta: { agent: selected.name },
          });
        }

        session.status = "streaming";
        sendEvent(ws, { type: "session.status", sessionId, status: "streaming", detail: "Finalizing..." });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        responseText = [
          "Local MLX LLM failed.",
          "",
          msg,
          "",
          "Fix:",
          "  bun run mlx:install -- --yes",
          "  bun run mlx:server",
          "",
          "Or from the TUI:",
          "  /install mlx --yes",
          "  /service mlx start",
        ].join("\n");
      }
    } else {
      responseText = [
        `I understand you said: "${content}"`,
        "",
        "This engine is currently running without an LLM.",
        "",
        "To use a local MLX model:",
        "  bun run mlx:install -- --yes",
        "  bun run mlx:server",
        "",
        "Or from the TUI:",
        "  /install mlx --yes",
        "  /service mlx start",
        "",
        "Tip: set AGENTLOOP_LLM=mlx to always try MLX.",
      ].join("\n");
    }
  }

  if (forceResponse) {
    responseText = forceResponse;
  }

  // Stream tokens (fallback for non-streaming paths)
  if (!alreadyStreamed) {
    const tokens = responseText.split(/(\s+)/);
    for (const token of tokens) {
      if (token) sendEvent(ws, { type: "assistant.token", sessionId, token });
    }
  }

  if (quickFollowup && responseText.trim()) {
    const followupBaseLength = session.messages.length;
    const followupSystem = [
      quickFollowup.system,
      "Continue with a bit more useful detail. Do not repeat the previous response.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const followupMessages = buildChatMessages({
      system: followupSystem,
      sessionMessages: session.messages,
      maxHistoryTurns: Math.max(quickFollowup.agent.maxHistoryTurns, 12),
    });
    const followupModel = envString("AGENTLOOP_MLX_MODEL_FOLLOWUP") ?? envString("AGENTLOOP_MLX_MODEL");
    const followupMaxTokens = envNumber("AGENTLOOP_MLX_MAX_TOKENS_FOLLOWUP") ?? 256;
    const followupTemp = envNumber("AGENTLOOP_MLX_TEMPERATURE_FOLLOWUP") ?? quickFollowup.agent.temperature ?? 0.2;

    const llmStart = Date.now();
    let tokenCount = 0;
    let ttfbSent = false;
    let streamBlocked = false;
    let followupContent = "";

    sendEvent(ws, { type: "assistant.token", sessionId, token: "\n\n" });

    try {
      const followup = await mlxChatCompletionStream(
        followupMessages,
        (token) => {
          if (session.messages.length !== followupBaseLength) return;
          if (streamBlocked) return;
          const scrubbed = scrubQuickToken(token);
          if (scrubbed.text) {
            tokenCount += 1;
            if (!ttfbSent) {
              ttfbSent = true;
              sendPerf(ws, {
                sessionId,
                name: "llm.ttfb",
                durationMs: Date.now() - llmStart,
                meta: { agent: quickFollowup.agent.name, mode: "followup" },
              });
            }
            sendEvent(ws, { type: "assistant.token", sessionId, token: scrubbed.text });
          }
          if (scrubbed.stop) streamBlocked = true;
        },
        { maxTokens: followupMaxTokens, model: followupModel, temperature: followupTemp }
      );
      followupContent = sanitizeQuickOutput(followup.content).trim();
      sendPerf(ws, {
        sessionId,
        name: "llm.total",
        durationMs: Date.now() - llmStart,
        meta: { agent: quickFollowup.agent.name, mode: "followup", tokens: tokenCount, model: followup.model },
      });
    } catch {
      // ignore follow-up failures; keep the original response
    }

    if (followupContent) {
      responseText = `${responseText}\n\n${followupContent}`;
    }
  }

  // Complete message
  const messageId = createId();
  const assistantMessage: Message = {
    id: messageId,
    role: "assistant",
    content: responseText,
    timestamp: Date.now(),
  };
  session.messages.push(assistantMessage);

  sendEvent(ws, { type: "assistant.message", sessionId, messageId, content: responseText });

  session.status = "idle";
  sendEvent(ws, { type: "session.status", sessionId, status: "idle", detail: "Ready" });

  if (workbenchPlan && workbenchIds.length > 0 && !quickFollowup) {
    const plan = workbenchPlan;
    const strategies = buildWorkbenchStrategies().filter((s) => workbenchIds.includes(s.id));
    void (async () => {
      if (!strategies.length) return;
      if (session.status !== "idle") return;

      for (const strategy of strategies) {
        const runStart = Date.now();
        try {
          const messages = buildChatMessages({
            system: plan.system,
            sessionMessages: plan.messages,
            maxHistoryTurns: strategy.maxHistoryTurns,
          });
          const out = await mlxChatCompletion(messages, {
            model: strategy.model,
            maxTokens: strategy.maxTokens,
            temperature: strategy.temperature,
          });
          sendPerf(ws, {
            sessionId,
            name: "workbench.strategy",
            durationMs: Date.now() - runStart,
            meta: {
              agent: plan.agent.name,
              strategy: strategy.id,
              model: out.model,
              primaryModel: plan.primaryModel,
              maxTokens: strategy.maxTokens,
              temperature: strategy.temperature,
              maxHistoryTurns: strategy.maxHistoryTurns,
              responseLength: out.content.length,
              primaryLength: plan.primaryResponse.length,
              jaccard: jaccardSimilarity(plan.primaryResponse, out.content),
              lengthRatio: lengthRatio(plan.primaryResponse, out.content),
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sendPerf(ws, {
            sessionId,
            name: "workbench.error",
            durationMs: Date.now() - runStart,
            meta: { strategy: strategy.id, model: strategy.model, error: msg },
          });
        }
      }
    })().catch(() => {});
  }

  // Follow-up is handled inline above to keep a single, integrated message.
}

function handleSessionCancel(ws: Bun.ServerWebSocket<unknown>, sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    session.status = "idle";
    sendEvent(ws, { type: "session.status", sessionId, status: "idle", detail: "Cancelled" });
  }
}

const services = new ServiceManager();
services.on((evt) => {
  if (evt.type === "status") {
    broadcastEvent({ type: "service.status", service: evt.service });
  } else {
    broadcastEvent({ type: "service.log", name: evt.name, stream: evt.stream, line: evt.line });
  }
});

async function handleServiceStart(ws: Bun.ServerWebSocket<unknown>, name: ServiceName) {
  try {
    await services.start(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent(ws, { type: "error", error: msg });
  }
}

async function handleServiceStop(ws: Bun.ServerWebSocket<unknown>, name: ServiceName) {
  try {
    await services.stop(name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent(ws, { type: "error", error: msg });
  }
}

function handleServiceStatus(ws: Bun.ServerWebSocket<unknown>, name?: ServiceName) {
  if (name) {
    sendEvent(ws, { type: "service.status", service: services.getState(name) });
  } else {
    for (const s of services.listStates()) {
      // Keep the default UI clean: don't spam stopped services unless explicitly requested.
      if (s.status === "stopped" && !s.lastError) continue;
      sendEvent(ws, { type: "service.status", service: s });
    }
  }
}

function handleCommand(ws: Bun.ServerWebSocket<unknown>, data: unknown) {
  const parsed = CommandSchema.safeParse(data);
  if (!parsed.success) {
    sendEvent(ws, { type: "error", error: `Invalid command: ${parsed.error.message}` });
    return;
  }

  const command = parsed.data;
  switch (command.type) {
    case "session.create":
      handleSessionCreate(ws, command.payload.sessionId);
      break;
    case "session.send":
      handleSessionSend(ws, command.payload.sessionId, command.payload.content, command.payload.images);
      break;
    case "session.configure":
      void handleSessionConfigure(ws, command.payload.sessionId, command.payload);
      break;
    case "session.cancel":
      handleSessionCancel(ws, command.payload.sessionId);
      break;
    case "agent.list":
      void handleAgentList(ws);
      break;
    case "service.start":
      void handleServiceStart(ws, command.payload.name);
      break;
    case "service.stop":
      void handleServiceStop(ws, command.payload.name);
      break;
    case "service.status":
      handleServiceStatus(ws, command.payload.name);
      break;
  }
}

await services.autoStartIfConfigured().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[engine] Failed to auto-start services: ${msg}`);
  process.exit(1);
});

const server = Bun.serve({
  hostname: cli.host,
  port: cli.port,
  fetch(req, server) {
    // Upgrade to WebSocket
    if (server.upgrade(req)) {
      return;
    }
    return new Response("AgentLoop Engine - WebSocket server", { status: 200 });
  },
  websocket: {
    open(ws) {
      console.log(`[engine] Client connected`);
      clients.add(ws);
      handleServiceStatus(ws);
    },
    message(ws, message) {
      try {
        const data = JSON.parse(message.toString());
        handleCommand(ws, data);
      } catch (err) {
        sendEvent(ws, { type: "error", error: `Failed to parse message: ${err}` });
      }
    },
    close(ws) {
      console.log(`[engine] Client disconnected`);
      clients.delete(ws);
    },
  },
});

if (cli.stateFile) {
  try {
    mkdirSync(dirname(cli.stateFile), { recursive: true });
    writeFileSync(
      cli.stateFile,
      JSON.stringify(
        {
          host: cli.host,
          port: server.port,
          pid: process.pid,
          startedAt: Date.now(),
        },
        null,
        2
      )
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[engine] Failed to write state file (${cli.stateFile}): ${msg}`);
  }
}

const purple = (s: string) => `\x1b[35m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(`
${purple("  ╭───────────────────────────────────────────────╮")}
${purple("  │")}       ${cyan("✦")} ${purple("AgentLoop Engine")} ${dim("v0.1.0")}             ${purple("│")}
${purple("  ├───────────────────────────────────────────────┤")}
${purple("  │")}  ${dim("WebSocket:")} ${cyan(`ws://${cli.host}:${server.port}`).padEnd(33)}${purple("│")}
${purple("  │")}  ${dim("Status:")}    ${green("● Ready")}                          ${purple("│")}
${purple("  ╰───────────────────────────────────────────────╯")}
`);

// Graceful shutdown
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[engine] Shutting down (${signal})...`);
  await services.stop("kokomo").catch(() => {});
  server.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
