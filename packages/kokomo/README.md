# @agentloop/kokomo

A tiny CLI bridge to a Kokomo TTS HTTP service. It reads text from `stdin` (or `--text`) and writes the response bytes to `stdout` (or `--out`).

## Examples

```sh
export KOKOMO_URL=http://127.0.0.1:8880

echo "hello from agentloop" | bun run --cwd packages/kokomo start --path /tts --out hello.wav
```

If your server expects JSON:

```sh
echo "hello" | bun run --cwd packages/kokomo start --mode json --field text --path /tts > hello.wav
```

Quick health check + play:

```sh
bun run --cwd packages/kokomo start --health
bun run --cwd packages/kokomo start --mode json --text "hello" --play
```

Even shorter:

```sh
bun run kokomo -- health
bun run kokomo -- say "hello there"
bun run kokomo -- say-local "hello there" # no HTTP server required
```

Root shortcuts:

```sh
bun run kokomo:say -- "hello there"       # HTTP (auto-starts local server if needed)
bun run kokomo:say-local -- "hello there" # local (no server)
```

## Managed Kokomo (engine)

If you want AgentLoop to start/stop Kokomo for you, run the engine with either:

- Your own `KOKOMO_CMD`/`KOKOMO_CMD_JSON`, or
- The built-in local wrapper (`scripts/services/kokomo/run-server.sh`) by opting into `KOKOMO_USE_DEFAULTS=1`.

```sh
export AGENTLOOP_MANAGE_KOKOMO=1
export KOKOMO_USE_DEFAULTS=1
export KOKOMO_HEALTH_URL="http://127.0.0.1:8880/health" # optional
bun run engine
```
