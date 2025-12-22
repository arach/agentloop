#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

MLX_BASE_DIR="${MLX_BASE_DIR:-$ROOT_DIR/external/mlx-llm}"
VENV_DIR="${MLX_VENV_DIR:-$MLX_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

ENV_FILE="${AGENTLOOP_ENV_FILE:-$ROOT_DIR/.agentloop/env}"
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    line="${raw#"${raw%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ( "$value" == \"*\" && "$value" == *\" ) || ( "$value" == \'*\' && "$value" == *\' ) ]]; then
      value="${value:1:-1}"
    fi
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      if [[ -z "${!key:-}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$ENV_FILE"
fi

if [[ ! -x "$PY" ]]; then
  echo "[mlx] venv not found at: $PY" >&2
  echo "[mlx] run: bun run mlx:install -- --yes" >&2
  exit 1
fi

# Keep model caches stable across runs (Hugging Face / XDG).
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$ROOT_DIR/.agentloop/cache}"
export HF_HOME="${HF_HOME:-$ROOT_DIR/.agentloop/hf}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-$HF_HOME/hub}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-$HF_HOME/transformers}"
mkdir -p "$XDG_CACHE_HOME" "$HF_HOME" "$HUGGINGFACE_HUB_CACHE" "$TRANSFORMERS_CACHE"

# Allow gated model downloads when a token is provided by AgentLoop.
if [[ -n "${AGENTLOOP_HF_TOKEN:-}" ]]; then
  export HUGGINGFACE_HUB_TOKEN="${HUGGINGFACE_HUB_TOKEN:-$AGENTLOOP_HF_TOKEN}"
  export HF_TOKEN="${HF_TOKEN:-$AGENTLOOP_HF_TOKEN}"
elif [[ -z "${HUGGINGFACE_HUB_TOKEN:-}" && -z "${HF_TOKEN:-}" ]]; then
  # Fall back to a Hugging Face CLI login token if present.
  for HF_LOGIN_FILE in "$HOME/.huggingface/token" "$HOME/.cache/huggingface/token"; do
    if [[ -r "$HF_LOGIN_FILE" ]]; then
      HF_LOGIN_TOKEN="$(head -n 1 "$HF_LOGIN_FILE" | tr -d '[:space:]')"
      if [[ -n "$HF_LOGIN_TOKEN" ]]; then
        export HUGGINGFACE_HUB_TOKEN="$HF_LOGIN_TOKEN"
        export HF_TOKEN="$HF_LOGIN_TOKEN"
        break
      fi
    fi
  done
fi

export MLX_HOST="${MLX_HOST:-127.0.0.1}"
export MLX_PORT="${MLX_PORT:-12345}"
export MLX_MODEL="${MLX_MODEL:-mlx-community/Llama-3.2-3B-Instruct-4bit}"
export MLX_MAX_TOKENS="${MLX_MAX_TOKENS:-256}"
export MLX_TEMPERATURE="${MLX_TEMPERATURE:-0.2}"
export MLX_TOP_P="${MLX_TOP_P:-0.9}"

exec "$PY" "$ROOT_DIR/scripts/services/mlx/server.py" --host "$MLX_HOST" --port "$MLX_PORT" --model "$MLX_MODEL"
