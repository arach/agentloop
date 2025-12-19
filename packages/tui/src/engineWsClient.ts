import { EventEmitter } from "node:events";
import type { Command, EngineEvent } from "@agentloop/core";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export class EngineWsClient extends EventEmitter {
  private host: string;
  private port: number;
  private ws: WebSocket | null = null;
  private _status: ConnectionStatus = "disconnected";

  constructor(opts: { host: string; port: number }) {
    super();
    this.host = opts.host;
    this.port = opts.port;
  }

  get url(): string {
    return `ws://${this.host}:${this.port}`;
  }

  setTarget(opts: { host: string; port: number }): void {
    const nextUrl = `ws://${opts.host}:${opts.port}`;
    const currentUrl = this.url;
    this.host = opts.host;
    this.port = opts.port;
    if (currentUrl !== nextUrl) this.emit("targetChanged", { host: this.host, port: this.port });
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this._status = "connecting";

    const ws = new WebSocket(this.url);
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
      this.emit("disconnected");
    }
  }

  send(command: Command): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(command));
  }
}
