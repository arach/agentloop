type TuiCli = {
  host: string;
  port: number;
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
    "agentloop (TUI)",
    "",
    "Usage:",
    "  bun run tui -- [--host 127.0.0.1] [--port 7777]",
    "",
    "Options:",
    "  --host <host>        Engine host (default: AGENTLOOP_HOST or 127.0.0.1)",
    "  --port <port>        Engine port (default: AGENTLOOP_PORT or 7777)",
    "  -h, --help           Show help",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

export function parseTuiCli(argv: string[]): TuiCli {
  let host = process.env.AGENTLOOP_HOST ?? "127.0.0.1";
  const envPort = envNumber("AGENTLOOP_PORT");
  let port = envPort ?? 7777;
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
      if (!Number.isFinite(v) || v <= 0 || v > 65535) throw new Error(`Invalid --port value`);
      port = v;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (help) printHelp();
  return { host, port, help };
}

