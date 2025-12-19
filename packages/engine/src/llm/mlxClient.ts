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

type StreamTokenHandler = (token: string) => void;

export async function mlxChatCompletionStream(
  messages: ChatMessage[],
  onToken: StreamTokenHandler,
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
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, top_p: topP, stream: true }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MLX chat failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ""}`);
  }
  const contentType = res.headers.get("content-type") ?? "";

  // Some MLX servers implement only non-streaming responses even when `stream:true`
  // is requested. In that case, treat it as a normal completion and locally emit
  // tokens so the rest of the pipeline stays consistent.
  if (!contentType.includes("text/event-stream")) {
    const json = (await res.json().catch(() => null)) as any;
    const content = String(json?.choices?.[0]?.message?.content ?? "");
    const usedModel = String(json?.model ?? model);
    if (!content.trim()) throw new Error("MLX chat returned empty content.");

    // Emit tokens without delay (the server didn't stream).
    for (const token of content.split(/(\s+)/)) {
      if (token) onToken(token);
    }
    return { model: usedModel, content };
  }

  if (!res.body) throw new Error("MLX stream response has no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usedModel = model;

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (!data) return;
    if (data === "[DONE]") return;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (typeof json?.model === "string") usedModel = json.model;
    const delta = json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? "";
    const token = String(delta ?? "");
    if (!token) return;
    content += token;
    onToken(token);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        flushLine(line);
      }
    }
    if (buffer.trim()) flushLine(buffer);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (!content.trim()) throw new Error("MLX stream returned empty content.");
  return { model: usedModel, content };
}
