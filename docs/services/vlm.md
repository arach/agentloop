# Service: vlm (VLM)

## What it is

Local MLX vision-language model server (`mlx-vlm`) exposing an OpenAI-ish endpoint at `/v1/chat/completions`.

## Install

```bash
bun run vlm:install -- --yes
```

## Run

- Engine-managed: `/service vlm start`
- Manual: `bun run vlm:server`

## Defaults

- URL: `http://127.0.0.1:12346`
- Health: `GET /health`
- Chat: `POST /v1/chat/completions`

## Recommended model

- `mlx-community/Qwen2-VL-2B-Instruct-4bit` (small/fast)

## Input format

The wrapper supports OpenAI-style content blocks in a user message, including `image_url` with a `data:` URL.

## Useful env vars

- `VLM_HOST`, `VLM_PORT`, `VLM_MODEL`
- `VLM_CMD` / `VLM_CMD_JSON` (override engine launch command)
- `AGENTLOOP_MANAGE_VLM=1` (auto-start on engine boot)
- `AGENTLOOP_HF_TOKEN` (for gated model downloads via Hugging Face)
- `AGENTLOOP_ENV_FILE` (optional env file path, default `.agentloop/env`)

If you already ran `huggingface-cli login`, the wrapper will reuse that token automatically.
