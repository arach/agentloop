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

if ! command -v python3 >/dev/null 2>&1; then
  echo "[mlx] python3 not found. Install Python 3.11+ (brew: python@3.11)" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "[mlx] uv not found. Install uv (brew: uv) or see https://github.com/astral-sh/uv" >&2
  exit 1
fi

MLX_BASE_DIR="${MLX_BASE_DIR:-$ROOT_DIR/external/mlx-llm}"
VENV_DIR="${MLX_VENV_DIR:-$MLX_BASE_DIR/.venv}"
PY="$VENV_DIR/bin/python"

venv_ok() {
  [[ -x "$PY" ]] || return 1
  "$PY" -c 'import mlx_lm' >/dev/null 2>&1
}

if [[ "$FORCE" -ne 1 ]] && venv_ok; then
  if [[ "$UPGRADE" -ne 1 ]]; then
    echo "[mlx] already installed: $VENV_DIR" >&2
    echo "[mlx] to upgrade: bun run mlx:install -- --yes --upgrade" >&2
    exit 0
  fi
fi

if [[ "$YES" -ne 1 ]]; then
  if [[ -t 0 ]]; then
    echo "[mlx] This will create a venv under ./external/ and download packages from PyPI + models from Hugging Face at runtime." >&2
    read -r -p "[mlx] Continue? [y/N] " reply
    if [[ ! "${reply}" =~ ^[Yy]$ ]]; then
      echo "[mlx] cancelled" >&2
      exit 1
    fi
  else
    echo "[mlx] non-interactive shell: pass --yes (or set AGENTLOOP_YES=1) to proceed" >&2
    exit 1
  fi
fi

mkdir -p "$MLX_BASE_DIR"
cd "$MLX_BASE_DIR"

echo "[mlx] creating venv in $VENV_DIR" >&2
uv venv --seed --python python3 "$VENV_DIR"

echo "[mlx] installing mlx-lm" >&2
uv pip install --python "$VENV_DIR/bin/python" --upgrade mlx-lm

echo "[mlx] done" >&2
echo "[mlx] run server: bun run mlx:server" >&2
