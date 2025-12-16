#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";

// Check if we have a TTY
const isTTY = process.stdin.isTTY && process.stdout.isTTY;

if (!isTTY) {
  console.error("AgentLoop TUI requires an interactive terminal.");
  console.error("Please run this directly from your terminal, not in the background.");
  process.exit(1);
}

// Clear screen and render
console.clear();

const { waitUntilExit } = render(<App />);

await waitUntilExit();
