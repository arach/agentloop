# AgentLoop Project State

This document describes what the repo does today (as implemented), and what’s stubbed/missing so it’s easy to decide “what next”.

## What’s Here

- `packages/core`: shared types + the JSON protocol (`CommandSchema` via `zod`), plus small utilities like `createId()`.
- `packages/engine`: a Bun `Bun.serve` WebSocket server with an in-memory session map; it accepts commands, updates session status, streams assistant output, and manages local services.
- `packages/tui`: an OpenTUI-based terminal UI with splash/about screens, multi-panel layout, selection, and managed service controls; it connects to the engine via WebSocket.
- `packages/kokomo`: a small CLI for local TTS (used by the TUI for `/say`).
- `scripts/`: local install + wrapper servers for TTS/LLM/VLM (installed into `external/`, which is gitignored).

## How It Works (Today)

### Engine behavior (`packages/engine/src/index.ts`)

- Listens on `ws://${AGENTLOOP_HOST}:${AGENTLOOP_PORT}` (defaults: `127.0.0.1:7777`).
- Maintains sessions in-memory only (`Map<string, Session>`).
- On `session.create`: creates a session and emits:
  - `session.created`
  - `session.status` (idle, “Session ready”)
- On `session.send`: appends the user message, emits:
  - `session.status` thinking → streaming
  - many `assistant.token` events (streaming)
  - one `assistant.message` (final content)
  - `session.status` idle (“Ready”)
- On `session.cancel`: sets status to idle and emits `session.status` “Cancelled” (it does not interrupt an in-progress token stream).

### Local model behavior (MLX)

- If the `mlx` service is running (or `AGENTLOOP_LLM=mlx`), the engine will call a local OpenAI-ish endpoint at `/v1/chat/completions` and stream the result to the TUI.
- If `mlx` is not running, the engine responds with instructions on how to install/start it.

### Service management (`packages/engine/src/services/ServiceManager.ts`)

- The engine can start/stop/status managed services and stream their logs to all connected TUIs.
- Services implemented:
  - `kokomo` (TTS, served over HTTP)
  - `mlx` (LLM, served over HTTP)
  - `vlm` (VLM, served over HTTP)

### TUI behavior (`packages/tui/src`)

- Shows a splash screen, then connects to the engine and creates a session.
- Multi-panel layout: Conversation + Services/Logs + Inspector + Composer (textarea).
- Supports selection/copy and shortcuts (also shown in the About modal):
  - `Ctrl+A`: About
  - `Tab`: cycle focus
  - `↑/↓`: command history (only at top/bottom of composer)
  - `Ctrl+Y`: copy last assistant message
  - `Ctrl+N`: new session
  - `Ctrl+R`: reconnect
  - `Ctrl+C`: quit
- Managed service controls (start/stop/status) and installers (`/install ... --yes`) are available in-UI.

## Protocol Snapshot

Commands (TUI → Engine) are validated by `CommandSchema` in `@agentloop/core`:

- `session.create` `{ sessionId?: string }`
- `session.send` `{ sessionId: string, content: string }`
- `session.cancel` `{ sessionId: string }`
- `service.start` `{ name: "kokomo" | "mlx" | "vlm" }`
- `service.stop` `{ name: "kokomo" | "mlx" | "vlm" }`
- `service.status` `{ name?: "kokomo" | "mlx" | "vlm" }`

Events (Engine → TUI) currently used:

- `session.created`
- `session.status`
- `assistant.token`
- `assistant.message`
- `service.status`
- `service.log`
- `error`

Types also exist for tool events (`tool.call`, `tool.result`) but the engine doesn’t emit them yet and the TUI doesn’t render them.

## Gaps / Known Limitations

- `session.cancel` is not cooperative: it doesn’t stop an active `session.send` stream.
- No persistence: sessions/messages are lost on engine restart.
- No session resume: the TUI starts a new session on connect and doesn’t attempt to rehydrate existing sessions.
- VLM usage is “service-ready”; the TUI now accepts drag/dropped image paths in the input, but the UX is still basic (single-turn vision, no gallery).

## Integration Point

To plug in a different agent backend, replace the logic in `packages/engine/src/index.ts` (`handleSessionSend`) to:

- emit `assistant.token` as tokens stream
- emit `assistant.message` when complete
- update `session.status` appropriately (thinking/streaming/tool_use/error)
