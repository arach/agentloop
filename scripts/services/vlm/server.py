#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any


def _load_vlm(model_id: str):
    try:
        # mlx-vlm API is evolving; we keep this in a small wrapper so errors are readable.
        from mlx_vlm import load  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "mlx-vlm is not installed in this venv. Run: bun run vlm:install -- --yes"
        ) from e

    model, processor = load(model_id)
    return model, processor


def _decode_image_from_message(messages: list[dict[str, Any]]) -> bytes | None:
    # Accept OpenAI-ish content blocks: [{type:'text',...},{type:'image_url', image_url:{url:'data:...'}}]
    for m in reversed(messages):
        if str(m.get("role") or "") != "user":
            continue
        content = m.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") != "image_url":
                    continue
                url = None
                image_url = part.get("image_url")
                if isinstance(image_url, dict):
                    url = image_url.get("url")
                elif isinstance(image_url, str):
                    url = image_url
                if not isinstance(url, str):
                    continue
                if url.startswith("data:"):
                    # data:image/png;base64,....
                    comma = url.find(",")
                    if comma >= 0:
                        b64 = url[comma + 1 :]
                        return base64.b64decode(b64)
    return None


def _extract_text(messages: list[dict[str, Any]]) -> str:
    # Prefer a user message string, else concatenate text parts.
    for m in reversed(messages):
        if str(m.get("role") or "") != "user":
            continue
        content = m.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    parts.append(str(part.get("text") or ""))
            txt = " ".join([p for p in parts if p.strip()])
            if txt:
                return txt
    return ""


class VlmServer(ThreadingHTTPServer):
    def __init__(self, addr, handler, model_id: str):
        super().__init__(addr, handler)
        self.model_id = model_id
        self.model, self.processor = _load_vlm(model_id)


class Handler(BaseHTTPRequestHandler):
    server_version = "agentloop-mlx-vlm/0.1"

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, b"ok\n", content_type="text/plain; charset=utf-8")
            return

        if self.path in ("/v1/models", "/models"):
            model_id = self.server.model_id  # type: ignore[attr-defined]
            payload = {"object": "list", "data": [{"id": model_id, "object": "model"}]}
            self._send(200, json.dumps(payload).encode("utf-8"))
            return

        self._send(404, json.dumps({"error": "not found"}).encode("utf-8"))

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            self._send(404, json.dumps({"error": "not found"}).encode("utf-8"))
            return

        length = int(self.headers.get("content-length") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self._send(400, json.dumps({"error": f"invalid json: {e}"}).encode("utf-8"))
            return

        messages = payload.get("messages") or []
        if not isinstance(messages, list) or not messages:
            self._send(400, json.dumps({"error": "missing messages[]"}).encode("utf-8"))
            return

        model_id = str(payload.get("model") or self.server.model_id)  # type: ignore[attr-defined]
        if model_id != self.server.model_id:  # type: ignore[attr-defined]
            self._send(
                400,
                json.dumps(
                    {
                        "error": "this server is started with a single model; restart with VLM_MODEL to change",
                        "model": self.server.model_id,  # type: ignore[attr-defined]
                    }
                ).encode("utf-8"),
            )
            return

        text = _extract_text(messages)
        image_bytes = _decode_image_from_message(messages)
        if not text and not image_bytes:
            self._send(400, json.dumps({"error": "provide user text and/or a data: image_url"}).encode("utf-8"))
            return

        max_tokens = int(payload.get("max_tokens") or int(os.environ.get("VLM_MAX_TOKENS", "256")))
        temperature = float(payload.get("temperature") or float(os.environ.get("VLM_TEMPERATURE", "0.2")))

        try:
            from PIL import Image  # type: ignore

            img = None
            if image_bytes:
                img = Image.open(BytesIO(image_bytes)).convert("RGB")

            # mlx-vlm API varies by version; try common entry points.
            try:
                from mlx_vlm import generate  # type: ignore

                content = generate(
                    self.server.model,  # type: ignore[attr-defined]
                    self.server.processor,  # type: ignore[attr-defined]
                    prompt=text,
                    image=img,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
            except Exception:
                # Fallback: some versions expose a `chat` function.
                from mlx_vlm import chat  # type: ignore

                content = chat(
                    self.server.model,  # type: ignore[attr-defined]
                    self.server.processor,  # type: ignore[attr-defined]
                    prompt=text,
                    image=img,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )
        except Exception as e:
            self._send(500, json.dumps({"error": f"vlm generation failed: {e}"}).encode("utf-8"))
            return

        now = int(time.time())
        response = {
            "id": f"chatcmpl-{now}",
            "object": "chat.completion",
            "created": now,
            "model": self.server.model_id,  # type: ignore[attr-defined]
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": str(content)},
                    "finish_reason": "stop",
                }
            ],
        }
        self._send(200, json.dumps(response).encode("utf-8"))

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        msg = fmt % args
        print(f"[vlm] {self.address_string()} {msg}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("VLM_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("VLM_PORT", "12346")))
    ap.add_argument("--model", default=os.environ.get("VLM_MODEL", "mlx-community/llava-v1.6-mistral-7b-4bit"))
    args = ap.parse_args()

    print(f"[vlm] loading model: {args.model}")
    httpd: VlmServer = VlmServer((args.host, args.port), Handler, args.model)
    print(f"[vlm] listening: http://{args.host}:{args.port} (OpenAI-ish: /v1/chat/completions)")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

