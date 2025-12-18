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

KOKOMO_BASE_DIR="${KOKOMO_BASE_DIR:-$ROOT_DIR/external/kokomo-mlx}"
VENV_DIR="${KOKOMO_VENV_DIR:-$KOKOMO_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

venv_has_pip() {
  if [[ ! -x "$PY" ]]; then return 1; fi
  "$PY" -c 'import pip' >/dev/null 2>&1
}

venv_has_runtime_deps() {
  if [[ ! -x "$PY" ]]; then return 1; fi
  "$PY" -c 'import mlx_audio; import mlx_audio.tts; import soundfile; import scipy; import sounddevice; import loguru; import misaki; import num2words' >/dev/null 2>&1
}

# Fast-path: if already installed, exit early without prompting.
if [[ -x "$PY" && "$FORCE" -ne 1 ]]; then
  if "$PY" -c 'import mlx_audio' >/dev/null 2>&1; then
    if ! venv_has_pip; then
      echo "[kokomo] existing venv is missing pip. Rebuild it with:" >&2
      echo "[kokomo]   bun run kokomo:install -- --yes --force" >&2
      exit 1
    fi

    if ! venv_has_runtime_deps; then
      if [[ "$UPGRADE" -ne 1 ]]; then
        echo "[kokomo] existing venv is missing runtime deps (e.g. soundfile)." >&2
        echo "[kokomo] to repair: bun run kokomo:install -- --yes --upgrade" >&2
        exit 1
      fi
    fi

    if [[ "$UPGRADE" -ne 1 ]]; then
      echo "[kokomo] already installed: $VENV_DIR" >&2
      echo "[kokomo] to upgrade: bun run kokomo:install -- --yes --upgrade" >&2
      exit 0
    fi

    if ! command -v uv >/dev/null 2>&1; then
      echo "[kokomo] uv not found. Install uv (brew: uv) or see https://github.com/astral-sh/uv" >&2
      exit 1
    fi

    echo "[kokomo] upgrading mlx-audio in: $VENV_DIR" >&2
    uv pip install --python "$PY" --upgrade "mlx-audio[tts]"
    echo "[kokomo] ensuring spaCy English model (en_core_web_sm) is installed" >&2
    if ! "$PY" -c "import spacy; spacy.load('en_core_web_sm')" >/dev/null 2>&1; then
      if "$PY" -m spacy download en_core_web_sm >/dev/null 2>&1; then
        echo "[kokomo] installed en_core_web_sm" >&2
      else
        echo "[kokomo] WARNING: failed to install en_core_web_sm; Kokoro may attempt to download it at runtime." >&2
      fi
    fi
    echo "[kokomo] done" >&2
    exit 0
  fi
fi

if [[ "$YES" -ne 1 ]]; then
  if [[ -t 0 ]]; then
    echo "[kokomo] This will create a venv under ./external/ and download Python packages from PyPI." >&2
    read -r -p "[kokomo] Continue? [y/N] " reply
    if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
      echo "[kokomo] cancelled" >&2
      exit 1
    fi
  else
    echo "[kokomo] non-interactive shell: pass --yes (or set AGENTLOOP_YES=1) to proceed" >&2
    exit 1
  fi
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[kokomo] python3 not found. Install Python 3.11+ (brew: python@3.11)" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "[kokomo] uv not found. Install uv (brew: uv) or see https://github.com/astral-sh/uv" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[kokomo] WARNING: ffmpeg not found. Install it (brew: ffmpeg) to avoid audio issues." >&2
fi

if ! command -v portaudio >/dev/null 2>&1; then
  # Not a command on macOS; keep as a gentle hint.
  true
fi

if ! command -v espeak-ng >/dev/null 2>&1; then
  echo "[kokomo] NOTE: espeak-ng not found. Some phonemizer edge cases may require it (brew: espeak-ng)." >&2
fi

mkdir -p "$KOKOMO_BASE_DIR"
cd "$KOKOMO_BASE_DIR"

echo "[kokomo] creating venv in $VENV_DIR" >&2
uv venv --seed --python python3 "$VENV_DIR"

echo "[kokomo] installing mlx-audio" >&2
uv pip install --python "$VENV_DIR/bin/python" "mlx-audio[tts]"

echo "[kokomo] ensuring spaCy English model (en_core_web_sm) is installed" >&2
if ! "$VENV_DIR/bin/python" -c "import spacy; spacy.load('en_core_web_sm')" >/dev/null 2>&1; then
  if "$VENV_DIR/bin/python" -m spacy download en_core_web_sm >/dev/null 2>&1; then
    echo "[kokomo] installed en_core_web_sm" >&2
  else
    echo "[kokomo] WARNING: failed to install en_core_web_sm; Kokoro may attempt to download it at runtime." >&2
  fi
fi

echo "[kokomo] done" >&2
echo "[kokomo] run server: bash $ROOT_DIR/scripts/services/kokomo/run-server.sh" >&2
