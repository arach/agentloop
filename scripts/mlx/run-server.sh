#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

MLX_BASE_DIR="${MLX_BASE_DIR:-$ROOT_DIR/external/mlx-llm}"
VENV_DIR="${MLX_VENV_DIR:-$MLX_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "[mlx] venv not found at: $PY" >&2
  echo "[mlx] run: bun run mlx:install -- --yes" >&2
  exit 1
fi

export MLX_HOST="${MLX_HOST:-127.0.0.1}"
export MLX_PORT="${MLX_PORT:-12345}"
export MLX_MODEL="${MLX_MODEL:-mlx-community/Llama-3.2-3B-Instruct-4bit}"
export MLX_MAX_TOKENS="${MLX_MAX_TOKENS:-256}"
export MLX_TEMPERATURE="${MLX_TEMPERATURE:-0.2}"
export MLX_TOP_P="${MLX_TOP_P:-0.9}"

exec "$PY" "$ROOT_DIR/scripts/mlx/server.py" --host "$MLX_HOST" --port "$MLX_PORT" --model "$MLX_MODEL"

