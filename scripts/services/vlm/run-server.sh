#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

VLM_BASE_DIR="${VLM_BASE_DIR:-$ROOT_DIR/external/mlx-vlm}"
VENV_DIR="${VLM_VENV_DIR:-$VLM_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "[vlm] venv not found at: $PY" >&2
  echo "[vlm] run: bun run vlm:install -- --yes" >&2
  exit 1
fi

export VLM_HOST="${VLM_HOST:-127.0.0.1}"
export VLM_PORT="${VLM_PORT:-12346}"
export VLM_MODEL="${VLM_MODEL:-mlx-community/llava-v1.6-mistral-7b-4bit}"
export VLM_MAX_TOKENS="${VLM_MAX_TOKENS:-256}"
export VLM_TEMPERATURE="${VLM_TEMPERATURE:-0.2}"

exec "$PY" "$ROOT_DIR/scripts/services/vlm/server.py" --host "$VLM_HOST" --port "$VLM_PORT" --model "$VLM_MODEL"
