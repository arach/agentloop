#!/usr/bin/env bun
import { parseTuiCli } from "./cli.js";
import { runTui } from "./openTuiApp.js";
import { run as runDoctor } from "./doctor.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger({ repoRoot: process.cwd(), alsoConsole: true });

process.on("uncaughtException", (err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  log.error(`uncaughtException: ${msg}`);
});

process.on("unhandledRejection", (reason) => {
  const msg =
    reason instanceof Error ? reason.stack || reason.message : typeof reason === "string" ? reason : JSON.stringify(reason);
  log.error(`unhandledRejection: ${msg}`);
});

const argv = process.argv.slice(2);
const subcommand = argv[0];

if (subcommand === "doctor") {
  const code = await runDoctor();
  process.exit(code);
}

// Check if we have a TTY
const isTTY = process.stdin.isTTY && process.stdout.isTTY;
if (!isTTY) {
  console.error("AgentLoop TUI requires an interactive terminal.");
  console.error("Please run this directly from your terminal, not in the background.");
  process.exit(1);
}

const cli = (() => {
  try {
    return parseTuiCli(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
})();

if (cli.help) process.exit(0);

await runTui({ engineHost: cli.host, enginePort: cli.port });
