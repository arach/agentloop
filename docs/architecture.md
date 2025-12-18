# Architecture

AgentLoop is a local-first “agent runtime” prototype made of three layers:

- **TUI** (`packages/tui`): interactive terminal UI (OpenTUI) for chat, service lifecycle, logs, and installs.
- **Engine** (`packages/engine`): Bun WebSocket server that owns sessions, streams assistant output, and supervises services.
- **Services** (`scripts/services/*` + `external/*`): managed local processes (TTS/LLM/VLM) installed into `external/` and exposed over localhost HTTP.

## Data flow

1. The TUI connects to the engine over WebSocket (`ws://AGENTLOOP_HOST:AGENTLOOP_PORT`).
2. The TUI sends commands (JSON) like:
   - `session.create`, `session.send`
   - `service.start|stop|status`
3. The engine emits events back to the TUI:
   - `session.status`, `assistant.token`, `assistant.message`
   - `service.status`, `service.log`
4. When configured, the engine routes chat generation to a local MLX HTTP server (`mlx`) and streams it back to the TUI.

## Contracts

The stable contract between the TUI and engine is `@agentloop/core`:

- `packages/core/src/index.ts` defines the Zod `CommandSchema` + `EngineEvent` union.
- Both `packages/tui` and `packages/engine` depend on this package and should treat it as the “API surface”.

## Service model

Services are “managed processes” supervised by the engine:

- Start/stop is performed by spawning a local command.
- Readiness is detected via a `GET /health` HTTP endpoint.
- Logs are captured and streamed back to the TUI as `service.log` events.

Service wrapper scripts live under `scripts/services/<name>/` and install into:

- `external/kokomo-mlx/` (TTS)
- `external/mlx-llm/` (LLM)
- `external/mlx-vlm/` (VLM)

All local installs and caches are ignored by git:

- `external/` (venvs, downloaded models, etc.)
- `.agentloop/` (local caches)

## Where to add things

- New TUI command/UX: `packages/tui/src/openTuiApp.ts`
- New engine command/event types: `packages/core/src/index.ts`
- New service: `packages/engine/src/services/ServiceManager.ts` + `scripts/services/<name>/`
- New installer: `packages/tui/src/utils/installers.ts`

