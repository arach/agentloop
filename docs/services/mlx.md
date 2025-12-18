# Service: mlx (LLM)

## What it is

Local MLX LLM server (`mlx-lm`) exposing an OpenAI-ish endpoint at `/v1/chat/completions`.

## Install

```bash
bun run mlx:install -- --yes
```

## Run

- Engine-managed: `/service mlx start`
- Manual: `bun run mlx:server`

## Defaults

- URL: `http://127.0.0.1:12345`
- Health: `GET /health`
- Chat: `POST /v1/chat/completions`

## Recommended models

- `mlx-community/Llama-3.2-3B-Instruct-4bit` (fast default)
- `mlx-community/Llama-3.1-8B-Instruct-4bit` (stronger)
- `mlx-community/Qwen2.5-7B-Instruct-4bit` (great instruction following)

## Useful env vars

- `MLX_HOST`, `MLX_PORT`, `MLX_MODEL`
- `MLX_CMD` / `MLX_CMD_JSON` (override engine launch command)
- `AGENTLOOP_MANAGE_MLX=1` (auto-start on engine boot)
- `AGENTLOOP_LLM=mlx` (engine prefers MLX for chat even if not marked running)

