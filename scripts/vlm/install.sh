#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

if ! command -v python3 >/dev/null 2>&1; then
  echo "[vlm] python3 not found. Install Python 3.11+ (brew: python@3.11)" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "[vlm] uv not found. Install uv (brew: uv) or see https://github.com/astral-sh/uv" >&2
  exit 1
fi

VLM_BASE_DIR="${VLM_BASE_DIR:-$ROOT_DIR/external/mlx-vlm}"
VENV_DIR="${VLM_VENV_DIR:-$VLM_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

venv_ok() {
  [[ -x "$PY" ]] || return 1
  "$PY" -c 'import PIL; import mlx; print("ok")' >/dev/null 2>&1 || return 1
  "$PY" -c 'import mlx_vlm' >/dev/null 2>&1
}

if [[ "$FORCE" -ne 1 ]] && venv_ok; then
  if [[ "$UPGRADE" -ne 1 ]]; then
    echo "[vlm] already installed: $VENV_DIR" >&2
    echo "[vlm] to upgrade: bun run vlm:install -- --yes --upgrade" >&2
    exit 0
  fi
fi

if [[ "$YES" -ne 1 ]]; then
  if [[ -t 0 ]]; then
    echo "[vlm] This will create a venv under ./external/ and download packages from PyPI + models from Hugging Face at runtime." >&2
    read -r -p "[vlm] Continue? [y/N] " reply
    if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
      echo "[vlm] cancelled" >&2
      exit 1
    fi
  else
    echo "[vlm] non-interactive shell: pass --yes (or set AGENTLOOP_YES=1) to proceed" >&2
    exit 1
  fi
fi

mkdir -p "$VLM_BASE_DIR"
cd "$VLM_BASE_DIR"

echo "[vlm] creating venv in $VENV_DIR" >&2
uv venv --seed --python python3 "$VENV_DIR"

echo "[vlm] installing deps (mlx-vlm + pillow)" >&2
uv pip install --python "$VENV_DIR/bin/python" --upgrade mlx-vlm pillow

echo "[vlm] done" >&2
echo "[vlm] run server: bun run vlm:server" >&2

