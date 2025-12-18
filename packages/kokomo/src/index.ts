#!/usr/bin/env bun
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
export {};
type HeaderKV = { key: string; value: string };

type Mode = "text" | "json";

type CliOptions = {
  url: string;
  path: string;
  method: string;
  mode: Mode;
  text?: string;
  field: string;
  voice?: string;
  format?: string;
  model?: string;
  headers: HeaderKV[];
  out?: string;
  play: boolean;
  health: boolean;
  local: boolean;
  ensureServer: boolean;
  timeoutMs: number;
  quiet: boolean;
  dryRun: boolean;
};

function printHelp(): void {
  const lines = [
    "agentloop-kokomo — pipe text into a Kokomo TTS HTTP endpoint",
    "",
    "Usage:",
    "  echo \"hello\" | agentloop-kokomo --url http://127.0.0.1:8880 --path /tts --out hello.wav",
    "  agentloop-kokomo --text \"hello\" --url http://127.0.0.1:8880 --path /tts > hello.wav",
    "  agentloop-kokomo say \"hello there\"",
    "  agentloop-kokomo say-local \"hello there\"",
    "  agentloop-kokomo health",
    "  agentloop-kokomo --text \"hello\" --mode json --play",
    "  agentloop-kokomo --health",
    "",
    "Options:",
    "  --url <baseUrl>          Base URL (or set KOKOMO_URL). Example: http://127.0.0.1:8880",
    "  --path <path>            Path to TTS route (default: /tts, or KOKOMO_PATH).",
    "  --method <METHOD>        HTTP method (default: POST).",
    "  --mode <text|json>       Body mode (default: text).",
    "  --text <string>          Text to synthesize (otherwise reads stdin).",
    "  --field <name>           JSON field name for text (default: text).",
    "  --voice <id>             Optional voice id (json mode only unless your server ignores it).",
    "  --format <fmt>           Optional format (json mode only).",
    "  --model <id>             Optional model (json mode only).",
    "  --header <k:v>           Extra header (repeatable).",
    "  --out <file>             Write response bytes to file (otherwise stdout).",
    "  --play                   Play audio after generating (implies --out to a temp file if not set).",
    "  --health                 Check GET /health and exit 0/1.",
    "  --local                  Use local mlx-audio generator (no HTTP server required).",
    "  --ensure-server          If HTTP server isn't reachable, start the local server wrapper and retry (default for `say`).",
    "  --no-ensure-server       Disable ensure-server behavior.",
    "  --timeout-ms <n>         Request timeout (default: 60000).",
    "  --dry-run                Print request details; do not send.",
    "  --quiet                  Suppress stderr info.",
    "  -h, --help               Show help.",
    "",
    "Notes:",
    "  - This tool treats the response as raw bytes (audio); it does not inspect content-type.",
    "  - If your Kokomo server expects a different schema, use --mode json and --field.",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function parseHeader(raw: string): HeaderKV {
  const idx = raw.indexOf(":");
  if (idx === -1) throw new Error(`Invalid header "${raw}". Expected "Key: Value".`);
  const key = raw.slice(0, idx).trim();
  const value = raw.slice(idx + 1).trim();
  if (!key) throw new Error(`Invalid header "${raw}". Header name is empty.`);
  return { key, value };
}

function parseArgs(argv: string[]): CliOptions {
  const defaultUrl =
    process.env.KOKOMO_URL ??
    `http://${process.env.KOKOMO_HOST ?? "127.0.0.1"}:${process.env.KOKOMO_PORT ?? "8880"}`;
  const defaultPath = process.env.KOKOMO_PATH ?? "/tts";

  const options: CliOptions = {
    url: defaultUrl,
    path: defaultPath,
    method: "POST",
    mode: "text",
    field: "text",
    headers: [],
    timeoutMs: 60_000,
    quiet: false,
    dryRun: false,
    play: false,
    health: false,
    local: false,
    ensureServer: false,
  };

  // Subcommands:
  //   say <text...>    => JSON mode + play
  //   say-local <text...> => local generator + play (no HTTP server required)
  //   health           => GET /health
  const first = argv[0];
  if (first === "say") {
    options.mode = "json";
    options.play = true;
    options.local = false;
    options.ensureServer = true;
    options.text = argv.slice(1).join(" ");
    return options;
  }
  if (first === "say-local") {
    options.mode = "json";
    options.play = true;
    options.local = true;
    options.text = argv.slice(1).join(" ");
    return options;
  }
  if (first === "health") {
    options.health = true;
    return options;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}`);
      i++;
      return value;
    };

    switch (arg) {
      case "--url":
        options.url = next();
        break;
      case "--path":
        options.path = next();
        break;
      case "--method":
        options.method = next().toUpperCase();
        break;
      case "--mode": {
        const value = next();
        if (value !== "text" && value !== "json") throw new Error(`Invalid --mode "${value}"`);
        options.mode = value;
        break;
      }
      case "--text":
        options.text = next();
        break;
      case "--field":
        options.field = next();
        break;
      case "--voice":
        options.voice = next();
        break;
      case "--format":
        options.format = next();
        break;
      case "--model":
        options.model = next();
        break;
      case "--header":
        options.headers.push(parseHeader(next()));
        break;
      case "--out":
        options.out = next();
        break;
      case "--play":
        options.play = true;
        break;
      case "--health":
        options.health = true;
        break;
      case "--local":
        options.local = true;
        break;
      case "--ensure-server":
        options.ensureServer = true;
        break;
      case "--no-ensure-server":
        options.ensureServer = false;
        break;
      case "--timeout-ms": {
        const value = Number(next());
        if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid --timeout-ms "${value}"`);
        options.timeoutMs = value;
        break;
      }
      case "--quiet":
        options.quiet = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function readAllStdin(): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function getRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const healthUrl = joinUrl(baseUrl, "/health");
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl, { method: "GET" });
      if (res.ok) return;
      lastErr = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(250);
  }
  throw new Error(`Health check failed: ${healthUrl}${lastErr ? ` (${lastErr})` : ""}`);
}

async function tryPlayAudioFile(filePath: string): Promise<boolean> {
  const platform = process.platform;
  const candidates: string[][] =
    platform === "darwin"
      ? [["afplay", filePath]]
      : platform === "linux"
        ? [["paplay", filePath], ["aplay", filePath]]
        : platform === "win32"
          ? [
              [
                "powershell",
                "-NoProfile",
                "-Command",
                `($p = New-Object Media.SoundPlayer '${filePath.replace(/'/g, "''")}'); $p.PlaySync();`,
              ],
            ]
          : [];

  for (const cmd of candidates) {
    try {
      const proc = Bun.spawn({ cmd, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      const code = await proc.exited;
      if (code === 0) return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return await Bun.file(p).exists();
  } catch {
    return false;
  }
}

async function findLocalGenerator(): Promise<string | null> {
  const base = getRepoRoot();
  const venvBin = path.join(base, "external/kokomo-mlx/.venv/bin");
  const candidates = [
    path.join(venvBin, "mlx_audio.tts.generate"),
    path.join(venvBin, "mlx-audio.generate"),
    path.join(venvBin, "mlx_audio.generate"),
  ];
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return null;
}

async function localGenerateWav(text: string, model: string): Promise<string> {
  const generator = await findLocalGenerator();
  if (!generator) {
    throw new Error("Local generator not found. Run `bun run kokomo:install -- --yes` first.");
  }

  const dir = `/tmp/agentloop-kokomo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  mkdirSync(dir, { recursive: true });
  const prefix = "out";

  const cmd = [
    generator,
    "--model",
    model,
    "--text",
    text,
    "--file_prefix",
    prefix,
    "--audio_format",
    "wav",
    "--join_audio",
  ];

  const proc = Bun.spawn({ cmd, cwd: dir, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
  ]);

  if (code !== 0) {
    const msg = (stderr || stdout || "").trim();
    throw new Error(`Local TTS failed (exit ${code})\n${msg}`);
  }

  const matches = Array.from(new Bun.Glob("*.wav").scanSync({ cwd: dir })).sort();
  const wav = matches[matches.length - 1];
  if (!wav) {
    const files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: dir })).sort();
    const out = (stdout || "").trim();
    const err = (stderr || "").trim();
    throw new Error(
      [
        `Local TTS succeeded but no .wav produced in ${dir}`,
        `cmd: ${cmd.join(" ")}`,
        `files: ${files.join(", ") || "(none)"}`,
        out ? `stdout:\n${out}` : "",
        err ? `stderr:\n${err}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }
  return `${dir}/${wav}`;
}

async function ensureServerRunning(baseUrl: string, timeoutMs: number, quiet: boolean): Promise<void> {
  try {
    await waitForHealthy(baseUrl, Math.min(timeoutMs, 2_000));
    return;
  } catch {
    // continue
  }

  const repoRoot = getRepoRoot();
  const script = path.join(repoRoot, "scripts/services/kokomo/run-server.sh");
  const venvPy = path.join(repoRoot, "external/kokomo-mlx/.venv/bin/python");

  if (!(await fileExists(script)) || !(await fileExists(venvPy))) {
    throw new Error(
      "Kokomo server not running, and local install not found. Run `bun run kokomo:install -- --yes` first."
    );
  }

  if (!quiet) process.stderr.write("[kokomo] starting local server wrapper…\n");
  // Best-effort background start; if it is already running, health check will succeed anyway.
  try {
    Bun.spawn({
      cmd: ["bash", script],
      cwd: repoRoot,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
  } catch {
    // ignore; we'll rely on health check
  }

  await waitForHealthy(baseUrl, timeoutMs);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.health) {
      const healthUrl = joinUrl(options.url, "/health");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      const res = await fetch(healthUrl, { method: "GET", signal: controller.signal }).finally(() =>
        clearTimeout(timeout)
      );
      if (!res.ok) throw new Error(`Health check failed: ${res.status} ${res.statusText}`);
      if (!options.quiet) process.stderr.write(`[kokomo] healthy: ${healthUrl}\n`);
      return;
    }

    const stdinText = options.text ?? (await readAllStdin());
    const text = stdinText.trimEnd();
    if (!text) throw new Error("No input text. Pass --text or pipe stdin.");

    const model = options.model ?? process.env.KOKOMO_MODEL ?? "mlx-community/Kokoro-82M-bf16";

    if (options.local) {
      const wavPath = await localGenerateWav(text, model);
      const outPath =
        options.out ??
        (options.play ? `/tmp/agentloop-kokomo-${Date.now()}-${Math.random().toString(16).slice(2)}.wav` : null);
      if (outPath) {
        await Bun.write(outPath, Bun.file(wavPath));
        if (!options.quiet) process.stderr.write(`[kokomo] wrote ${await Bun.file(outPath).size} bytes to ${outPath}\n`);
        if (options.play) {
          const ok = await tryPlayAudioFile(outPath);
          if (!ok) throw new Error(`Failed to play audio (no supported player found). File saved at: ${outPath}`);
        }
        return;
      }
      process.stdout.write(new Uint8Array(await Bun.file(wavPath).arrayBuffer()));
      return;
    }

    if (options.ensureServer) {
      await ensureServerRunning(options.url, options.timeoutMs, options.quiet);
    }

    const url = joinUrl(options.url, options.path);

    const headers = new Headers();
    for (const { key, value } of options.headers) headers.set(key, value);

    let body: unknown;
    if (options.mode === "json") {
      const payload: Record<string, unknown> = { [options.field]: text };
      if (options.voice) payload.voice = options.voice;
      if (options.format) payload.format = options.format;
      if (options.model) payload.model = options.model;
      body = JSON.stringify(payload);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    } else {
      body = text;
      if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");
    }

    if (!options.quiet || options.dryRun) {
      process.stderr.write(`[kokomo] ${options.method} ${url}\n`);
      process.stderr.write(`[kokomo] mode=${options.mode} bytes(out)=${options.out ?? "stdout"}\n`);
    }

    if (options.dryRun) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const res = await fetch(url, {
      method: options.method,
      headers,
      body: body as any,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const textErr = await res.text().catch(() => "");
      throw new Error(
        `Request failed: ${res.status} ${res.statusText}${textErr ? `\n${textErr}` : ""}`
      );
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const outPath =
      options.out ??
      (options.play
        ? await (async () => {
            const tmp = `/tmp/agentloop-kokomo-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`;
            return tmp;
          })()
        : null);

    if (outPath) {
      await Bun.write(outPath, bytes);
      if (!options.quiet) process.stderr.write(`[kokomo] wrote ${bytes.length} bytes to ${outPath}\n`);
      if (options.play) {
        const ok = await tryPlayAudioFile(outPath);
        if (!ok) throw new Error(`Failed to play audio (no supported player found). File saved at: ${outPath}`);
      }
      return;
    }

    process.stdout.write(bytes);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

await main();
