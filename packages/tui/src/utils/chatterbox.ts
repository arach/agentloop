import path from "node:path";
import { mkdirSync } from "node:fs";

type ChatterboxTtsOptions = {
  url?: string;
  path?: string;
  timeoutMs?: number;
  exaggeration?: number;
  temperature?: number;
  cfgWeight?: number;
  seed?: number;
  chunkSize?: number;
};

function getChatterboxBaseUrlFromEnv(): string {
  const explicit = process.env.CHATTERBOX_URL;
  if (explicit) return explicit;
  const host = process.env.CHATTERBOX_HOST ?? "127.0.0.1";
  const port = process.env.CHATTERBOX_PORT ?? "8890";
  return `http://${host}:${port}`;
}

function joinUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function chatterboxTtsToWavFile(
  text: string,
  options: ChatterboxTtsOptions = {}
): Promise<{ filePath: string; bytes: number }> {
  const baseUrl = options.url ?? getChatterboxBaseUrlFromEnv();
  const pathname = options.path ?? "/tts";
  const url = joinUrl(baseUrl, pathname);
  const timeoutMs = options.timeoutMs ?? 120_000;

  const payload: Record<string, unknown> = { text };
  if (options.exaggeration != null) payload.exaggeration = options.exaggeration;
  if (options.temperature != null) payload.temperature = options.temperature;
  if (options.cfgWeight != null) payload.cfg_weight = options.cfgWeight;
  if (options.seed != null) payload.seed = options.seed;
  if (options.chunkSize != null) payload.chunk_size = options.chunkSize;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Chatterbox TTS failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ""}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const outDir = path.resolve(process.cwd(), ".agentloop/audio");
  mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `say-${Date.now()}.wav`);
  await Bun.write(filePath, bytes);
  return { filePath, bytes: bytes.length };
}
