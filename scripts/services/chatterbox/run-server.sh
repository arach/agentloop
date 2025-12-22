#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

CHATTERBOX_BASE_DIR="${CHATTERBOX_BASE_DIR:-$ROOT_DIR/external/chatterbox-tts}"
VENV_DIR="${CHATTERBOX_VENV_DIR:-$CHATTERBOX_BASE_DIR/.venv}"
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
  echo "[chatterbox] venv not found at: $PY" >&2
  echo "[chatterbox] run: bash scripts/services/chatterbox/install.sh --yes" >&2
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

export CHATTERBOX_HOST="${CHATTERBOX_HOST:-127.0.0.1}"
export CHATTERBOX_PORT="${CHATTERBOX_PORT:-8890}"
export CHATTERBOX_DEVICE="${CHATTERBOX_DEVICE:-cpu}"
export CHATTERBOX_EXAGGERATION="${CHATTERBOX_EXAGGERATION:-1.0}"
export CHATTERBOX_TEMPERATURE="${CHATTERBOX_TEMPERATURE:-0.7}"
export CHATTERBOX_CFG_WEIGHT="${CHATTERBOX_CFG_WEIGHT:-0.5}"
export CHATTERBOX_CHUNK_SIZE="${CHATTERBOX_CHUNK_SIZE:-250}"

exec "$PY" "$ROOT_DIR/scripts/services/chatterbox/server.py" --host "$CHATTERBOX_HOST" --port "$CHATTERBOX_PORT"
