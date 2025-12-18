import path from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

type KokomoTtsOptions = {
  url?: string;
  path?: string;
  model?: string;
  timeoutMs?: number;
};

function getRepoRoot(): string {
  // This file lives at: packages/tui/src/utils/kokomo.ts
  // Repo root is 4 levels up from its directory.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
}

function getKokomoVenvPython(): string {
  const repoRoot = getRepoRoot();
  return path.join(repoRoot, "external/kokomo-mlx/.venv/bin/python");
}

function getKokomoBaseUrlFromEnv(): string {
  const explicit = process.env.KOKOMO_URL;
  if (explicit) return explicit;
  const host = process.env.KOKOMO_HOST ?? "127.0.0.1";
  const port = process.env.KOKOMO_PORT ?? "8880";
  return `http://${host}:${port}`;
}

function joinUrl(baseUrl: string, pathname: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
}

export async function kokomoTtsToWavFile(
  text: string,
  options: KokomoTtsOptions = {}
): Promise<{ filePath: string; bytes: number }> {
  const baseUrl = options.url ?? getKokomoBaseUrlFromEnv();
  const pathname = options.path ?? "/tts";
  const url = joinUrl(baseUrl, pathname);
  const model = options.model ?? process.env.KOKOMO_MODEL ?? "mlx-community/Kokoro-82M-bf16";
  const timeoutMs = options.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, model }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Kokomo TTS failed: ${res.status} ${res.statusText}${body ? `\n${body}` : ""}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const outDir = path.resolve(process.cwd(), ".agentloop/audio");
  mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `say-${Date.now()}.wav`);
  await Bun.write(filePath, bytes);
  return { filePath, bytes: bytes.length };
}

async function findMlxAudioGenerator(): Promise<string | null> {
  const repoRoot = getRepoRoot();
  const venvBin = path.join(repoRoot, "external/kokomo-mlx/.venv/bin");
  const candidates = [
    path.join(venvBin, "mlx_audio.tts.generate"),
    path.join(venvBin, "mlx-audio.generate"),
    path.join(venvBin, "mlx_audio.generate"),
  ];
  for (const p of candidates) {
    try {
      if (await Bun.file(p).exists()) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

async function preflightKokomoVenv(): Promise<void> {
  const py = getKokomoVenvPython();
  if (!(await Bun.file(py).exists())) {
    throw new Error("Kokomo venv not found. Run `bun run kokomo:install -- --yes` first.");
  }

  const proc = Bun.spawn({
    cmd: [
      py,
      "-c",
      "import mlx_audio, soundfile, scipy, sounddevice; print('ok')",
    ],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
  ]);

  if (code === 0) return;
  const msg = (stderr || stdout || "").trim();
  throw new Error(
    [
      "Kokomo venv is missing runtime deps (or is broken).",
      "Fix: `bun run kokomo:install -- --yes --upgrade` (or `--force` to rebuild).",
      msg ? `\n${msg}` : "",
    ].join("\n")
  );
}

function findGeneratedWav(prefixPath: string): string | null {
  const dir = path.dirname(prefixPath);
  const base = path.basename(prefixPath);
  try {
    const matches = Array.from(new Bun.Glob(`${base}*.wav`).scanSync({ cwd: dir }));
    if (matches.length === 0) return null;
    matches.sort();
    return path.join(dir, matches[matches.length - 1]!);
  } catch {
    return null;
  }
}

export async function kokomoTtsLocalToWavFile(
  text: string,
  options: Pick<KokomoTtsOptions, "model"> = {}
): Promise<{ filePath: string; bytes: number }> {
  const generator = await findMlxAudioGenerator();
  if (!generator) {
    throw new Error("Local mlx-audio generator not found. Run `bun run kokomo:install -- --yes` first.");
  }

  await preflightKokomoVenv();

  const model = options.model ?? process.env.KOKOMO_MODEL ?? "mlx-community/Kokoro-82M-bf16";
  const outDir = path.resolve(process.cwd(), ".agentloop/audio");
  mkdirSync(outDir, { recursive: true });
  const prefixBase = `say-${Date.now()}`;
  const prefixPath = path.join(outDir, prefixBase);

  const cmd = [
    generator,
    "--model",
    model,
    "--text",
    text,
    "--file_prefix",
    prefixBase,
    "--audio_format",
    "wav",
    "--join_audio",
  ];

  const proc = Bun.spawn({
    cmd,
    cwd: outDir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
  ]);

  if (code !== 0) {
    const msg = (stderr || stdout || "").trim();
    throw new Error(`mlx-audio failed (exit ${code})\n${msg}`);
  }

  const wavPath = findGeneratedWav(prefixPath);
  if (!wavPath) {
    throw new Error(`mlx-audio succeeded but no .wav produced under ${outDir}`);
  }

  const bytes = (await Bun.file(wavPath).arrayBuffer()).byteLength;
  return { filePath: wavPath, bytes };
}

export async function tryPlayAudioFile(filePath: string): Promise<boolean> {
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
