#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

KOKOMO_BASE_DIR="${KOKOMO_BASE_DIR:-$ROOT_DIR/external/kokomo-mlx}"
VENV_DIR="${KOKOMO_VENV_DIR:-$KOKOMO_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

if [[ ! -x "$PY" ]]; then
  echo "[kokomo] venv not found at: $PY" >&2
  echo "[kokomo] run: bash scripts/kokomo/install.sh --yes" >&2
  exit 1
fi

export KOKOMO_HOST="${KOKOMO_HOST:-127.0.0.1}"
export KOKOMO_PORT="${KOKOMO_PORT:-8880}"
export KOKOMO_MODEL="${KOKOMO_MODEL:-mlx-community/Kokoro-82M-bf16}"

exec "$PY" "$ROOT_DIR/scripts/kokomo/server.py" --host "$KOKOMO_HOST" --port "$KOKOMO_PORT" --model "$KOKOMO_MODEL"
