type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type MlxChatOptions = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
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

export async function mlxChatCompletion(
  messages: ChatMessage[],
  opts: MlxChatOptions = {}
): Promise<{ model: string; content: string }> {
  const baseUrl = opts.baseUrl ?? envString("AGENTLOOP_MLX_URL") ?? "http://127.0.0.1:12345";
  const url = joinUrl(baseUrl, "/v1/chat/completions");
  const model = opts.model ?? envString("AGENTLOOP_MLX_MODEL") ?? envString("MLX_MODEL") ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";

  const timeoutMs = opts.timeoutMs ?? envNumber("AGENTLOOP_MLX_TIMEOUT_MS") ?? 120_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const maxTokens = opts.maxTokens ?? envNumber("AGENTLOOP_MLX_MAX_TOKENS") ?? envNumber("MLX_MAX_TOKENS") ?? 256;
  const temperature = opts.temperature ?? envNumber("AGENTLOOP_MLX_TEMPERATURE") ?? envNumber("MLX_TEMPERATURE") ?? 0.2;
  const topP = opts.topP ?? envNumber("AGENTLOOP_MLX_TOP_P") ?? envNumber("MLX_TOP_P") ?? 0.9;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, top_p: topP, stream: false }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MLX chat failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ""}`);
  }

  const json = (await res.json()) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "");
  const usedModel = String(json?.model ?? model);
  if (!content.trim()) throw new Error("MLX chat returned empty content.");
  return { model: usedModel, content };
}

