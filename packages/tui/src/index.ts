#!/usr/bin/env bun
import { parseTuiCli } from "./cli.js";
import { runTui } from "./openTuiApp.js";

// Check if we have a TTY
const isTTY = process.stdin.isTTY && process.stdout.isTTY;
if (!isTTY) {
  console.error("AgentLoop TUI requires an interactive terminal.");
  console.error("Please run this directly from your terminal, not in the background.");
  process.exit(1);
}

const cli = (() => {
  try {
    return parseTuiCli(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }
})();

if (cli.help) process.exit(0);

await runTui({ engineHost: cli.host, enginePort: cli.port });

