import { EventEmitter } from "node:events";
import { createId, type Command, type EngineEvent } from "@agentloop/core";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export class EngineWsClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private ws: WebSocket | null = null;
  private _status: ConnectionStatus = "disconnected";
  private _sessionId: string | null = null;

  constructor(opts: { host: string; port: number }) {
    super();
    this.host = opts.host;
    this.port = opts.port;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this._status = "connecting";

    const ws = new WebSocket(`ws://${this.host}:${this.port}`);
    this.ws = ws;

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(String(e.data)) as EngineEvent;
        this.emit("event", event);
      } catch {
        // ignore
      }
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this._status = "connected";
        this.emit("connected");
        const sessionId = createId();
        this._sessionId = sessionId;
        ws.send(JSON.stringify({ type: "session.create", payload: { sessionId } } satisfies Command));
        resolve();
      };

      ws.onerror = () => {
        this._status = "error";
        this.emit("event", { type: "error", error: "Connection failed" } satisfies EngineEvent);
        reject(new Error("Connection failed"));
      };

      ws.onclose = () => {
        this._status = "disconnected";
        this.ws = null;
        this.emit("disconnected");
        reject(new Error("Connection closed"));
      };
    });
  }

  disconnect(): void {
    try {
      this.ws?.close();
    } catch {
      // ignore
    } finally {
      this.ws = null;
      this._status = "disconnected";
      this._sessionId = null;
      this.emit("disconnected");
    }
  }

  send(command: Command): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(command));
  }
}
