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

function joinUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

function envNumber(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function envString(key: string): string | undefined {
  const raw = process.env[key];
  return raw ? raw : undefined;
}

function defaultBaseUrl(): string {
  const host = envString("VLM_HOST") ?? "127.0.0.1";
  const port = envString("VLM_PORT") ?? "12346";
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
