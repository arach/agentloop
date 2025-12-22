import path from "node:path";
import { fileURLToPath } from "node:url";

export type InstallerId = "kokomo" | "chatterbox" | "mlx" | "mlx-model" | "vlm";

export type InstallerSpec = {
  id: InstallerId;
  title: string;
  description: string;
  preview: string[];
  run: (args: string[]) => { cmd: string[]; cwd: string };
};

function repoRoot(): string {
  // packages/tui/src/utils/installers.ts -> repo root
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
}

function quoteArg(arg: string): string {
  return arg.includes(" ") ? JSON.stringify(arg) : arg;
}

export function formatCmd(cmd: string[]): string {
  return cmd.map(quoteArg).join(" ");
}

export const installers: Record<InstallerId, InstallerSpec> = {
  kokomo: {
    id: "kokomo",
    title: "Kokomo (local TTS via mlx-audio[tts])",
    description: "Creates ./external/kokomo-mlx venv and installs required Python deps via uv.",
    preview: [
      "Creates venv under ./external/kokomo-mlx/.venv",
      "Installs Python deps via uv (downloads from PyPI)",
      "Leaves installed files untracked (external/ is gitignored)",
    ],
    run: () => {
      const root = repoRoot();
      return { cmd: ["bash", path.join(root, "scripts/services/kokomo/install.sh"), "--yes", "--upgrade"], cwd: root };
    },
  },
  chatterbox: {
    id: "chatterbox",
    title: "Chatterbox TTS (voice cloning)",
    description: "Creates ./external/chatterbox-tts venv and installs chatterbox-tts via uv.",
    preview: [
      "Creates venv under ./external/chatterbox-tts/.venv",
      "Installs chatterbox-tts + PyTorch deps via uv (downloads from PyPI)",
      "Models are downloaded on first use (Hugging Face)",
    ],
    run: () => {
      const root = repoRoot();
      return { cmd: ["bash", path.join(root, "scripts/services/chatterbox/install.sh"), "--yes", "--upgrade"], cwd: root };
    },
  },
  mlx: {
    id: "mlx",
    title: "MLX LLM tooling (mlx-lm)",
    description: "Creates ./external/mlx-llm venv and installs mlx-lm via uv.",
    preview: [
      "Creates venv under ./external/mlx-llm/.venv",
      "Installs mlx-lm via uv (downloads from PyPI)",
      "Models are downloaded on first use (Hugging Face)",
    ],
    run: () => {
      const root = repoRoot();
      return { cmd: ["bash", path.join(root, "scripts/services/mlx/install.sh"), "--yes", "--upgrade"], cwd: root };
    },
  },
  vlm: {
    id: "vlm",
    title: "MLX VLM tooling (mlx-vlm)",
    description: "Creates ./external/mlx-vlm venv and installs mlx-vlm via uv.",
    preview: [
      "Creates venv under ./external/mlx-vlm/.venv",
      "Installs mlx-vlm via uv (downloads from PyPI)",
      "Models are downloaded on first use (Hugging Face)",
    ],
    run: () => {
      const root = repoRoot();
      return { cmd: ["bash", path.join(root, "scripts/services/vlm/install.sh"), "--yes", "--upgrade"], cwd: root };
    },
  },
  "mlx-model": {
    id: "mlx-model",
    title: "MLX model (prefetch)",
    description: "Downloads a model into the local MLX cache by loading it once.",
    preview: [
      "Downloads model weights to your local cache (can be large)",
      "Requires mlx-lm installed (run: /install mlx)",
    ],
    run: (args: string[]) => {
      const root = repoRoot();
      const model = args[0] ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";
      const py = path.join(root, "external/mlx-llm/.venv/bin/python");
      const code = `from mlx_lm import load; load(${JSON.stringify(model)}); print("ok")`;
      return { cmd: [py, "-c", code], cwd: root };
    },
  },
};

export async function runInstaller(
  spec: InstallerSpec,
  args: string[],
  onLine: (line: string) => void
): Promise<number> {
  const { cmd, cwd } = spec.run(args);
  onLine(`$ ${formatCmd(cmd)}`);
  const proc = Bun.spawn({ cmd, cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

  const decoder = new TextDecoder();
  const pump = async (stream: ReadableStream<Uint8Array> | null, prefix: string) => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = decoder.decode(value);
        for (const rawLine of chunk.split(/\r?\n/)) {
          const line = rawLine.trimEnd();
          if (!line) continue;
          onLine(`${prefix}${line}`);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  };

  await Promise.all([pump(proc.stdout, ""), pump(proc.stderr, "! ")]);
  return await proc.exited;
}
