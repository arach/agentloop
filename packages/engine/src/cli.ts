type EngineCli = {
  host: string;
  port: number;
  kokomoLocal: boolean;
  help: boolean;
};

function envNumber(key: string): number | null {
  const raw = process.env[key];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function printHelp(): void {
  const lines = [
    "agentloop-engine",
    "",
    "Usage:",
    "  bun run engine -- [--host 127.0.0.1] [--port 7777|0] [--random-port] [--kokomo-local]",
    "",
    "Options:",
    "  --host <host>        Bind host (default: AGENTLOOP_HOST or 127.0.0.1)",
    "  --port <port>        Bind port (default: AGENTLOOP_PORT or 7777). Use 0 for an ephemeral port.",
    "  --random-port        Alias for --port 0",
    "  --kokomo-local       Enable built-in local MLX Kokomo defaults (equivalent to AGENTLOOP_KOKOMO_LOCAL=1).",
    "  -h, --help           Show help",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

export function parseEngineCli(argv: string[]): EngineCli {
  let host = process.env.AGENTLOOP_HOST ?? "127.0.0.1";
  const envPort = envNumber("AGENTLOOP_PORT");
  let port = envPort ?? 7777;
  let kokomoLocal = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    const next = () => {
      const v = argv[i + 1];
      if (!v) throw new Error(`Missing value for ${arg}`);
      i++;
      return v;
    };

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "--host") {
      host = next();
      continue;
    }

    if (arg === "--port") {
      const v = Number(next());
      if (!Number.isFinite(v) || v < 0 || v > 65535) throw new Error(`Invalid --port value`);
      port = v;
      continue;
    }

    if (arg === "--random-port") {
      port = 0;
      continue;
    }

    if (arg === "--kokomo-local") {
      kokomoLocal = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (help) printHelp();
  return { host, port, kokomoLocal, help };
}
