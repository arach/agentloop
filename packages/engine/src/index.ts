#!/usr/bin/env bun
import {
  CommandSchema,
  DEFAULT_CONFIG,
  createId,
  type Command,
  type EngineEvent,
  type Session,
  type Message,
} from "@agentloop/core";

const HOST = process.env.AGENTLOOP_HOST ?? DEFAULT_CONFIG.engineHost;
const PORT = Number(process.env.AGENTLOOP_PORT ?? DEFAULT_CONFIG.enginePort);

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

  // Generate a stubbed response (this is where the real agent logic would go)
  const responses = [
    `I understand you said: "${content}"\n\nI'm currently running as a stub agent. In a real implementation, this is where you'd integrate your LLM of choice (Claude, GPT, Llama, etc.) to process messages and generate intelligent responses.\n\nTo integrate a real agent, edit the \`handleSessionSend\` function in \`packages/engine/src/index.ts\`.`,
    `Thanks for your message! Here's what I heard: "${content}"\n\nThis response is being streamed token by token, just like a real LLM would do. The agent loop architecture supports:\n\n• Streaming responses\n• Tool calls (coming soon)\n• Session management\n• Multiple concurrent sessions`,
    `Got it! You said: "${content}"\n\nI'm the AgentLoop stub agent, demonstrating the TUI and engine communication. The beautiful interface you're seeing is built with Ink (React for terminals) and communicates with this engine via WebSocket.\n\nPretty cool, right?`,
  ];
  const responseText = responses[Math.floor(Math.random() * responses.length)];

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
  }
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
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
${purple("  │")}  ${dim("WebSocket:")} ${cyan(`ws://${HOST}:${PORT}`).padEnd(33)}${purple("│")}
${purple("  │")}  ${dim("Status:")}    ${green("● Ready")}                          ${purple("│")}
${purple("  ╰───────────────────────────────────────────────╯")}
`);

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[engine] Shutting down...");
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[engine] Shutting down...");
  server.stop();
  process.exit(0);
});
