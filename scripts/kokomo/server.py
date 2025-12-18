#!/usr/bin/env python3
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _pick_generator() -> list[str] | None:
    # CLI names vary by version; try common candidates.
    candidates = ("mlx_audio.tts.generate", "mlx-audio.generate", "mlx_audio.generate")

    venv_bin = os.path.dirname(sys.executable)
    for name in candidates:
        direct = os.path.join(venv_bin, name)
        if os.path.isfile(direct) and os.access(direct, os.X_OK):
            return [direct]

    for name in candidates:
        path = shutil.which(name)
        if path:
            return [path]
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "agentloop-kokomo-mlx/0.1"

    def _send(self, status: int, body: bytes, content_type: str = "text/plain; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, b"ok\n")
            return
        if self.path == "/":
            self._send(200, b"agentloop kokomo mlx tts server\n")
            return
        self._send(404, b"not found\n")

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/tts":
            self._send(404, b"not found\n")
            return

        length = int(self.headers.get("content-length") or "0")
        raw = self.rfile.read(length) if length > 0 else b""
        content_type = (self.headers.get("content-type") or "").lower()

        text = ""
        model = self.server.model  # type: ignore[attr-defined]

        if "application/json" in content_type:
            try:
                payload = json.loads(raw.decode("utf-8") if raw else "{}")
                text = str(payload.get("text") or payload.get("input") or "")
                model = str(payload.get("model") or model)
            except Exception as e:
                self._send(400, f"invalid json: {e}\n".encode("utf-8"))
                return
        else:
            text = raw.decode("utf-8", errors="replace")

        text = text.strip()
        if not text:
            self._send(400, b"missing text\n")
            return

        generator = self.server.generator  # type: ignore[attr-defined]
        if not generator:
            self._send(
                500,
                b"mlx-audio generator not found. Install mlx-audio in your venv.\n",
            )
            return

        with tempfile.TemporaryDirectory(prefix="agentloop-kokomo-") as tmpdir:
            out_path = os.path.join(tmpdir, "out.wav")
            file_prefix = os.path.join(tmpdir, "out")

            cmd = [
                *generator,
                "--model",
                model,
                "--text",
                text,
                "--file_prefix",
                file_prefix,
                "--audio_format",
                "wav",
                "--join_audio",
            ]
            try:
                completed = subprocess.run(
                    cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE
                )
                stdout_text = (completed.stdout or b"").decode("utf-8", errors="replace").strip()
                stderr_text = (completed.stderr or b"").decode("utf-8", errors="replace").strip()
            except subprocess.CalledProcessError as e:
                msg = (e.stderr or e.stdout or b"").decode("utf-8", errors="replace")
                hint = ""
                if "No module named pip" in msg:
                    hint = (
                        "\nHint: your venv is missing pip. Run:\n"
                        "  bun run kokomo:install -- --yes --force\n"
                    )
                if "No module named 'soundfile'" in msg or "No module named soundfile" in msg:
                    hint = (
                        "\nHint: your venv is missing runtime deps. Run:\n"
                        "  bun run kokomo:install -- --yes --upgrade\n"
                    )
                if "No module named 'scipy'" in msg or "No module named scipy" in msg:
                    hint = (
                        "\nHint: your venv is missing runtime deps. Run:\n"
                        "  bun run kokomo:install -- --yes --upgrade\n"
                    )
                if "No module named 'sounddevice'" in msg or "No module named sounddevice" in msg:
                    hint = (
                        "\nHint: your venv is missing runtime deps. Run:\n"
                        "  bun run kokomo:install -- --yes --upgrade\n"
                    )
                if "No module named 'loguru'" in msg or "No module named loguru" in msg:
                    hint = (
                        "\nHint: your venv is missing runtime deps. Run:\n"
                        "  bun run kokomo:install -- --yes --upgrade\n"
                    )
                if "No module named 'misaki'" in msg or "No module named misaki" in msg:
                    hint = (
                        "\nHint: your venv is missing runtime deps. Run:\n"
                        "  bun run kokomo:install -- --yes --upgrade\n"
                    )
                self._send(
                    500,
                    (
                        "tts failed\n"
                        f"command: {' '.join(cmd)}\n\n"
                        f"{msg}\n{hint}"
                    ).encode("utf-8"),
                )
                return

            produced = None
            if os.path.exists(out_path):
                produced = out_path
            else:
                candidates: list[str] = []
                candidates.extend(glob.glob(f"{file_prefix}*.wav"))
                candidates.extend(glob.glob(os.path.join(tmpdir, "*.wav")))
                if candidates:
                    produced = sorted(candidates)[-1]

            if not produced or not os.path.exists(produced):
                files = []
                try:
                    files = sorted(os.listdir(tmpdir))
                except Exception:
                    files = []
                self._send(
                    500,
                    (
                        "tts failed: no output wav produced\n"
                        f"tmpdir: {tmpdir}\n"
                        f"files: {files}\n"
                        f"stdout: {stdout_text if stdout_text else '(empty)'}\n"
                        f"stderr: {stderr_text if stderr_text else '(empty)'}\n"
                    ).encode("utf-8"),
                )
                return

            try:
                with open(produced, "rb") as f:
                    wav = f.read()
            except Exception as e:
                self._send(500, f"failed to read output: {e}\n".encode("utf-8"))
                return

        self._send(200, wav, content_type="audio/wav")

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        # Keep logs terse; engine will capture stdout/stderr anyway.
        msg = fmt % args
        print(f"[kokomo] {self.address_string()} {msg}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("KOKOMO_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("KOKOMO_PORT", "8880")))
    ap.add_argument(
        "--model",
        default=os.environ.get("KOKOMO_MODEL", "mlx-community/Kokoro-82M-bf16"),
    )
    args = ap.parse_args()

    generator = _pick_generator()
    if not generator:
        print(
            "[kokomo] WARNING: no mlx-audio generator binary found on PATH. "
            "Did you activate the venv and install mlx-audio?"
        )

    httpd: ThreadingHTTPServer = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.model = args.model  # type: ignore[attr-defined]
    httpd.generator = generator  # type: ignore[attr-defined]
    print(f"[kokomo] listening on http://{args.host}:{args.port} (model={args.model})")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
