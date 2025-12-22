import { SERVICE_BY_NAME } from "@agentloop/core";
import { envNumber, envString } from "../utils/env.js";
import { joinUrl } from "../utils/url.js";

type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentBlock[];
};

export type VlmChatOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
};

function defaultBaseUrl(): string {
  const defaults = SERVICE_BY_NAME.vlm;
  const host = envString("VLM_HOST") ?? defaults.defaultHost;
  const port = envString("VLM_PORT") ?? String(defaults.defaultPort);
  return `http://${host}:${port}`;
}

export async function vlmChatCompletion(
  messages: ChatMessage[],
  opts: VlmChatOptions = {}
): Promise<{ model: string; content: string }> {
  const baseUrl = opts.baseUrl ?? envString("VLM_URL") ?? defaultBaseUrl();
  const url = joinUrl(baseUrl, "/v1/chat/completions");
  const model =
    opts.model ?? envString("VLM_MODEL") ?? "mlx-community/Qwen2-VL-2B-Instruct-4bit";

  const timeoutMs = opts.timeoutMs ?? envNumber("VLM_TIMEOUT_MS") ?? 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const maxTokens = opts.maxTokens ?? envNumber("VLM_MAX_TOKENS") ?? 256;
  const temperature = opts.temperature ?? envNumber("VLM_TEMPERATURE") ?? 0.2;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`VLM chat failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ""}`);
  }

  const json = (await res.json()) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  const usedModel = String(json?.model ?? model);
  if (!content.trim()) throw new Error("VLM chat returned empty content.");
  return { model: usedModel, content };
}
