# Service: kokomo (TTS)

## What it is

Local text-to-speech using `mlx-audio[tts]` (Kokoro) wrapped behind a tiny HTTP server.

## Install

```bash
bun run kokomo:install -- --yes
```

## Run

- Engine-managed: `/service kokomo start`
- Manual: `bun run kokomo:server`

## Defaults

- URL: `http://127.0.0.1:8880`
- Health: `GET /health`
- Synthesis: `POST /tts` (JSON `{ text, model }`) → WAV bytes

## Useful env vars

- `KOKOMO_HOST`, `KOKOMO_PORT`, `KOKOMO_MODEL`
- `KOKOMO_CMD` / `KOKOMO_CMD_JSON` (override engine launch command)
- `AGENTLOOP_MANAGE_KOKOMO=1` (auto-start on engine boot)

