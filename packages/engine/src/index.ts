#!/usr/bin/env bun
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

// In-memory session store
const sessions = new Map<string, Session>();

function createSession(id: string): Session {
  return {
    id,
    status: "idle",
    messages: [],
    toolCalls: [],
    createdAt: Date.now(),
  };
}

function sendEvent(ws: Bun.ServerWebSocket<unknown>, event: EngineEvent) {
  ws.send(JSON.stringify(event));
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

async function handleSessionSend(ws: Bun.ServerWebSocket<unknown>, sessionId: string, content: string) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = createSession(sessionId);
    sessions.set(sessionId, session);
  }

  // Add user message
  const userMessage: Message = {
    id: createId(),
    role: "user",
    content,
    timestamp: Date.now(),
  };
  session.messages.push(userMessage);
  session.status = "thinking";

  sendEvent(ws, { type: "session.status", sessionId, status: "thinking", detail: "Processing..." });

  // Simulate thinking delay
  await Bun.sleep(300);

  session.status = "streaming";
  sendEvent(ws, { type: "session.status", sessionId, status: "streaming", detail: "Generating response..." });

  const useMlx =
    (process.env.AGENTLOOP_LLM ?? "").toLowerCase() === "mlx" ||
    (services.getState("mlx").status === "running");

  let responseText = "";
  if (useMlx) {
    try {
      session.status = "tool_use";
      sendEvent(ws, { type: "session.status", sessionId, status: "tool_use", detail: "Agent + tools..." });

      const sys = process.env.AGENTLOOP_SYSTEM_PROMPT?.trim();
      responseText = await runSimpleAgent({
        sessionMessages: session.messages,
        services,
        systemPrompt: sys,
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
      });

      session.status = "streaming";
      sendEvent(ws, { type: "session.status", sessionId, status: "streaming", detail: "Generating response..." });
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

  // Stream tokens
  const tokens = responseText.split(/(\s+)/);
  for (const token of tokens) {
    if (token) {
      sendEvent(ws, { type: "assistant.token", sessionId, token });
      await Bun.sleep(20); // Simulate streaming delay
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
      handleSessionSend(ws, command.payload.sessionId, command.payload.content);
      break;
    case "session.cancel":
      handleSessionCancel(ws, command.payload.sessionId);
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
