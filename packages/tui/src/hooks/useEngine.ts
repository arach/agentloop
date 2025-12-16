import { useState, useEffect, useCallback, useRef } from "react";
import {
  DEFAULT_CONFIG,
  createId,
  type Command,
  type EngineEvent,
  type Message,
  type Session,
} from "@agentloop/core";

interface UseEngineOptions {
  host?: string;
  port?: number;
  autoConnect?: boolean;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export function useEngine(options: UseEngineOptions = {}) {
  const host = options.host ?? DEFAULT_CONFIG.engineHost;
  const port = options.port ?? DEFAULT_CONFIG.enginePort;

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<Session["status"]>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Batching for streaming content to reduce flickering
  const streamingBufferRef = useRef("");
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FLUSH_INTERVAL_MS = 100; // Flush every 100ms - higher = smoother but more delayed

  const flushStreamingBuffer = useCallback(() => {
    if (streamingBufferRef.current) {
      setStreamingContent(streamingBufferRef.current);
    }
    flushTimeoutRef.current = null;
  }, []);

  const send = useCallback((command: Command) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
    }
  }, []);

  const handleEvent = useCallback((event: EngineEvent) => {
    switch (event.type) {
      case "session.created":
        setSessionId(event.sessionId);
        break;

      case "session.status":
        setSessionStatus(event.status);
        if (event.status === "streaming") {
          streamingBufferRef.current = "";
          setStreamingContent("");
        }
        break;

      case "assistant.token":
        // Accumulate tokens in buffer
        streamingBufferRef.current += event.token;
        // Schedule a flush if not already scheduled
        if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(flushStreamingBuffer, FLUSH_INTERVAL_MS);
        }
        break;

      case "assistant.message":
        // Clear any pending flush
        if (flushTimeoutRef.current) {
          clearTimeout(flushTimeoutRef.current);
          flushTimeoutRef.current = null;
        }
        streamingBufferRef.current = "";
        setMessages((prev) => [
          ...prev,
          {
            id: event.messageId,
            role: "assistant",
            content: event.content,
            timestamp: Date.now(),
          },
        ]);
        setStreamingContent("");
        break;

      case "error":
        setError(event.error);
        break;
    }
  }, [flushStreamingBuffer]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    setError(null);

    const ws = new WebSocket(`ws://${host}:${port}`);

    ws.onopen = () => {
      setStatus("connected");
      // Create a session on connect
      const newSessionId = createId();
      ws.send(JSON.stringify({ type: "session.create", payload: { sessionId: newSessionId } }));
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as EngineEvent;
        handleEvent(event);
      } catch {
        // Ignore parse errors
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
    };

    ws.onerror = () => {
      setStatus("error");
      setError("Connection failed");
    };

    wsRef.current = ws;
  }, [host, port, handleEvent]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      if (!sessionId) return;

      // Add user message immediately
      const userMessage: Message = {
        id: createId(),
        role: "user",
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      send({ type: "session.send", payload: { sessionId, content } });
    },
    [sessionId, send]
  );

  const newSession = useCallback(() => {
    // Clear any pending flush
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    streamingBufferRef.current = "";
    setMessages([]);
    setStreamingContent("");
    setSessionStatus("idle");
    const newSessionId = createId();
    setSessionId(newSessionId);
    send({ type: "session.create", payload: { sessionId: newSessionId } });
  }, [send]);

  // Auto-connect on mount
  useEffect(() => {
    if (options.autoConnect !== false) {
      connect();
    }
    return () => disconnect();
  }, []);

  return {
    status,
    sessionId,
    sessionStatus,
    messages,
    streamingContent,
    error,
    connect,
    disconnect,
    sendMessage,
    newSession,
  };
}
