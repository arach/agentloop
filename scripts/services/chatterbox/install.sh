#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# Keep caches inside the repo so installs work in sandboxed environments.
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$ROOT_DIR/.agentloop/cache}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$ROOT_DIR/.agentloop/uv-cache}"
mkdir -p "$XDG_CACHE_HOME" "$UV_CACHE_DIR"

YES=0
UPGRADE=0
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --upgrade) UPGRADE=1 ;;
    --force) FORCE=1 ;;
  esac
done

if [[ "${AGENTLOOP_YES:-}" == "1" ]]; then YES=1; fi

CHATTERBOX_BASE_DIR="${CHATTERBOX_BASE_DIR:-$ROOT_DIR/external/chatterbox-tts}"
VENV_DIR="${CHATTERBOX_VENV_DIR:-$CHATTERBOX_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

venv_has_runtime_deps() {
  if [[ ! -x "$PY" ]]; then return 1; fi
  "$PY" -c 'import chatterbox, torch, torchaudio, soundfile, numpy' >/dev/null 2>&1
}

# Fast-path: if already installed, exit early without prompting.
if [[ -x "$PY" && "$FORCE" -ne 1 ]]; then
  if venv_has_runtime_deps; then
    if [[ "$UPGRADE" -ne 1 ]]; then
      echo "[chatterbox] already installed: $VENV_DIR" >&2
      echo "[chatterbox] to upgrade: bun run chatterbox:install -- --yes --upgrade" >&2
      exit 0
    fi
  else
    if [[ "$UPGRADE" -ne 1 ]]; then
      echo "[chatterbox] existing venv is missing runtime deps." >&2
      echo "[chatterbox] to repair: bun run chatterbox:install -- --yes --upgrade" >&2
      exit 1
    fi
  fi
fi

if [[ "$YES" -ne 1 ]]; then
  if [[ -t 0 ]]; then
    echo "[chatterbox] This will create a venv under ./external/ and download Python packages from PyPI." >&2
    read -r -p "[chatterbox] Continue? [y/N] " reply
    if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
      echo "[chatterbox] cancelled" >&2
      exit 1
    fi
  else
    echo "[chatterbox] non-interactive shell: pass --yes (or set AGENTLOOP_YES=1) to proceed" >&2
    exit 1
  fi
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[chatterbox] python3 not found. Install Python 3.11+ (brew: python@3.11)" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "[chatterbox] uv not found. Install uv (brew: uv) or see https://github.com/astral-sh/uv" >&2
  exit 1
fi

mkdir -p "$CHATTERBOX_BASE_DIR"
cd "$CHATTERBOX_BASE_DIR"

if [[ ! -x "$PY" || "$FORCE" -eq 1 ]]; then
  echo "[chatterbox] creating venv in $VENV_DIR" >&2
  uv venv --seed --python python3 "$VENV_DIR"
fi

echo "[chatterbox] installing chatterbox-tts + deps" >&2
uv pip install --python "$PY" \
  chatterbox-tts \
  torch \
  torchvision \
  torchaudio \
  numpy \
  soundfile \
  librosa \
  scipy \
  tqdm \
  Pillow \
  transformers \
  accelerate \
  resampy

echo "[chatterbox] done" >&2
echo "[chatterbox] run server: bash $ROOT_DIR/scripts/services/chatterbox/run-server.sh" >&2
