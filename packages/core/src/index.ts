import { z } from "zod";

// Message types
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
}

export type ServiceName = "kokomo" | "mlx" | "vlm";
export type ServiceStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ServiceState {
  name: ServiceName;
  status: ServiceStatus;
  pid?: number;
  detail?: string;
  lastExitCode?: number;
  lastError?: string;
}

// Session state
export interface Session {
  id: string;
  status: "idle" | "thinking" | "streaming" | "tool_use" | "error";
  messages: Message[];
  toolCalls: ToolCall[];
  createdAt: number;
}

// Protocol schemas
export const CommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.create"),
    payload: z.object({
      sessionId: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("session.send"),
    payload: z.object({
      sessionId: z.string(),
      content: z.string(),
    }),
  }),
  z.object({
    type: z.literal("session.cancel"),
    payload: z.object({
      sessionId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("service.start"),
    payload: z.object({
      name: z.enum(["kokomo", "mlx", "vlm"]),
    }),
  }),
  z.object({
    type: z.literal("service.stop"),
    payload: z.object({
      name: z.enum(["kokomo", "mlx", "vlm"]),
    }),
  }),
  z.object({
    type: z.literal("service.status"),
    payload: z.object({
      name: z.enum(["kokomo", "mlx", "vlm"]).optional(),
    }),
  }),
]);

export type Command = z.infer<typeof CommandSchema>;

// Event types from engine to TUI
export type EngineEvent =
  | { type: "session.created"; sessionId: string }
  | { type: "session.status"; sessionId: string; status: Session["status"]; detail?: string }
  | { type: "assistant.token"; sessionId: string; token: string }
  | { type: "assistant.message"; sessionId: string; messageId: string; content: string }
  | { type: "tool.call"; sessionId: string; tool: ToolCall }
  | { type: "tool.result"; sessionId: string; toolId: string; result: unknown }
  | { type: "service.status"; service: ServiceState }
  | { type: "service.log"; name: ServiceName; stream: "stdout" | "stderr"; line: string }
  | { type: "error"; sessionId?: string; error: string };

// Client interface for connecting to engine
export interface EngineClient {
  connect(): Promise<void>;
  disconnect(): void;
  send(command: Command): void;
  on(event: "event", handler: (event: EngineEvent) => void): void;
  on(event: "connected" | "disconnected", handler: () => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// Configuration
export interface AgentLoopConfig {
  engineHost: string;
  enginePort: number;
}

export const DEFAULT_CONFIG: AgentLoopConfig = {
  engineHost: "127.0.0.1",
  enginePort: 7777,
};

// Utility to create a unique ID
export function createId(): string {
  return crypto.randomUUID();
}
