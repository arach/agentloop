# AgentLoop

A reusable terminal-based agent loop harness built with Bun + TypeScript. Provides a beautiful TUI for interacting with an agentic backend.

## Features

- Beautiful terminal UI with splash screen
- Real-time streaming responses
- WebSocket-based communication between TUI and engine
- Modular architecture for easy integration
- Session management
- Keyboard shortcuts

## Architecture

```
packages/
├── core/      # Shared types, protocol definitions, utilities
├── engine/    # WebSocket server that runs the agent loop
├── tui/       # Terminal user interface (Ink + React)
└── kokomo/    # Optional CLI bridge to a Kokomo TTS service
```

## Project Status

This repo is a working UI + engine scaffold: the TUI is functional, and the engine currently streams stubbed responses (no real LLM/tools yet). More detail: `docs/state.md`.

## Quick Start

```bash
# Install dependencies
bun install

# Terminal 1: Start the engine
bun run engine

# Terminal 2: Start the TUI
bun run tui
```

### Engine management (stop/restart/ports)

- Stop the engine: `Ctrl+C` in the engine terminal.
- Restart the engine: stop (`Ctrl+C`) then run `bun run engine` again.
- Change ports:
  - Engine: `bun run engine -- --port 7778`
  - TUI: `bun run tui -- --port 7778`
- Random free port (engine): `bun run engine -- --random-port` (prints the chosen `ws://...` URL on startup).

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+N` | New session |
| `Ctrl+R` | Reconnect to engine |
| `Ctrl+C` | Quit |

## TUI Commands

Type these into the message box:

- `/help`
- `/service kokomo start|stop|status` (also: `/kokomo start|stop|status`)

## Local TTS (Kokomo defaults)

```bash
bun run kokomo:install -- --yes
bun run tui
```

Then in the TUI: `/service kokomo start`

## Local LLM (MLX)

This repo includes a tiny MLX LLM HTTP server wrapper for Apple Silicon Macs. It exposes an OpenAI-ish endpoint at `/v1/chat/completions`.

```bash
bun run mlx:install -- --yes
bun run mlx:server
```

Defaults:

- Host/port: `127.0.0.1:12345` (`MLX_HOST`, `MLX_PORT`)
- Model: `mlx-community/Llama-3.2-3B-Instruct-4bit` (`MLX_MODEL`)

Recommended open models (mlx-community conversions):

- `mlx-community/Llama-3.2-3B-Instruct-4bit` (fast, lightweight default)
- `mlx-community/Llama-3.1-8B-Instruct-4bit` (strong general model, more RAM)
- `mlx-community/Qwen2.5-7B-Instruct-4bit` (great instruction-following/code, more RAM)

Health check:

```bash
curl http://127.0.0.1:12345/health
```

## Local VLM (MLX)

This repo also includes a tiny MLX VLM HTTP server wrapper (OpenAI-ish `/v1/chat/completions`) intended for local vision + text.

```bash
bun run vlm:install -- --yes
bun run vlm:server
```

Defaults:

- Host/port: `127.0.0.1:12346` (`VLM_HOST`, `VLM_PORT`)
- Model: `mlx-community/llava-v1.6-mistral-7b-4bit` (`VLM_MODEL`)

Notes:

- This wrapper currently supports `messages[].content` with OpenAI-style `image_url` parts using `data:` URLs.

## Configuration

Environment variables:

- `AGENTLOOP_HOST` - Engine host (default: `127.0.0.1`)
- `AGENTLOOP_PORT` - Engine port (default: `7777`)
- `AGENTLOOP_MANAGE_KOKOMO` - If `1`, the engine will auto-start Kokomo on boot (you can also start/stop it from the TUI).
- `AGENTLOOP_MANAGE_MLX` - If `1`, the engine will auto-start the MLX LLM service on boot.
- `AGENTLOOP_MANAGE_VLM` - If `1`, the engine will auto-start the MLX VLM service on boot.
- `KOKOMO_CMD` - Command string to launch Kokomo (overrides defaults).
- `KOKOMO_CMD_JSON` - Same as above, but as a JSON array of args (overrides defaults).
- `KOKOMO_USE_DEFAULTS` - If `1`, uses `bash scripts/kokomo/run-server.sh` when no command is provided.
- `AGENTLOOP_KOKOMO_LOCAL` - Single-switch for local MLX defaults (implies `KOKOMO_USE_DEFAULTS=1`).
- `KOKOMO_HOST` - Default Kokomo host for the built-in wrapper (default: `127.0.0.1`).
- `KOKOMO_PORT` - Default Kokomo port for the built-in wrapper (default: `8880`).
- `KOKOMO_MODEL` - Default model for the built-in wrapper (default: `mlx-community/Kokoro-82M-bf16`).
- `KOKOMO_HEALTH_URL` - Health URL to poll until ready (defaults to `http://KOKOMO_HOST:KOKOMO_PORT/health` when using defaults).
- `KOKOMO_READY_TIMEOUT_MS` - Health check timeout (default: `15000`).
- `MLX_HOST`, `MLX_PORT`, `MLX_MODEL` - MLX LLM wrapper configuration.
- `MLX_CMD`, `MLX_CMD_JSON` - Override engine-managed MLX LLM launch command.
- `VLM_HOST`, `VLM_PORT`, `VLM_MODEL` - MLX VLM wrapper configuration.
- `VLM_CMD`, `VLM_CMD_JSON` - Override engine-managed MLX VLM launch command.

Note: both the engine and the TUI accept `--host/--port` flags, and also read `AGENTLOOP_HOST/AGENTLOOP_PORT`.

## Development

```bash
# Run engine with hot reload
bun run --cwd packages/engine dev

# Run TUI with hot reload
bun run --cwd packages/tui dev

# Pipe text to a Kokomo TTS HTTP endpoint (writes audio bytes to stdout/file)
bun run kokomo -- --help

# Type check all packages
bun run --filter '*' typecheck
```

## Integrating AgentLoop

The engine can use a local MLX LLM if you start the `mlx` service (or set `AGENTLOOP_LLM=mlx`). To integrate a different real agent:

1. Edit `packages/engine/src/index.ts`
2. Replace the `handleSessionSend` function with your agent logic
3. Stream tokens using the `assistant.token` event
4. Complete with `assistant.message` and `session.status` events

### Event Protocol

**TUI → Engine (Commands):**
- `session.create` - Create a new session
- `session.send` - Send a user message
- `session.cancel` - Cancel current operation

**Engine → TUI (Events):**
- `session.created` - Session was created
- `session.status` - Session status changed (idle/thinking/streaming/error)
- `assistant.token` - Token streamed from assistant
- `assistant.message` - Complete assistant message
- `error` - Error occurred

## License

MIT
