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
└── tui/       # Terminal user interface (Ink + React)
```

## Quick Start

```bash
# Install dependencies
bun install

# Terminal 1: Start the engine
bun run engine

# Terminal 2: Start the TUI
bun run tui
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+N` | New session |
| `Ctrl+R` | Reconnect to engine |
| `Ctrl+C` | Quit |

## Configuration

Environment variables:

- `AGENTLOOP_HOST` - Engine host (default: `127.0.0.1`)
- `AGENTLOOP_PORT` - Engine port (default: `7777`)

## Development

```bash
# Run engine with hot reload
bun run --cwd packages/engine dev

# Run TUI with hot reload
bun run --cwd packages/tui dev

# Type check all packages
bun run --filter '*' typecheck
```

## Integrating AgentLoop

The engine currently returns stub responses. To integrate a real agent:

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
