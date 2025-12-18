#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _load_mlx_model(model_id: str):
    try:
        from mlx_lm import load  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "mlx-lm is not installed in this venv. Run: bun run mlx:install -- --yes"
        ) from e

    model, tokenizer = load(model_id)
    return model, tokenizer


def _build_prompt(tokenizer, messages: list[dict]) -> str:
    # Prefer HF chat template if the tokenizer supports it.
    try:
        apply = getattr(tokenizer, "apply_chat_template", None)
        if callable(apply):
            return apply(messages, tokenize=False, add_generation_prompt=True)
    except Exception:
        pass

    # Fallback: naive transcript. Works, but won't match model-specific templates.
    parts: list[str] = []
    for m in messages:
        role = str(m.get("role") or "user")
        content = str(m.get("content") or "")
        parts.append(f"{role.upper()}: {content}")
    parts.append("ASSISTANT:")
    return "\n".join(parts)


def _generate(model, tokenizer, prompt: str, max_tokens: int, temperature: float, top_p: float) -> str:
    from mlx_lm import generate  # type: ignore

    # mlx-lm has changed argument names across versions (temp vs temperature).
    # Try the older name first, then fall back.
    try:
        return generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            temp=temperature,
            top_p=top_p,
        )
    except TypeError:
        return generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
        )


class MlxServer(ThreadingHTTPServer):
    def __init__(self, addr, handler, model_id: str):
        super().__init__(addr, handler)
        self.model_id = model_id
        self.model, self.tokenizer = _load_mlx_model(model_id)
        self.lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = "agentloop-mlx-llm/0.1"

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
                        "error": "this server is started with a single model; restart with MLX_MODEL to change",
                        "model": self.server.model_id,  # type: ignore[attr-defined]
                    }
                ).encode("utf-8"),
            )
            return

        max_tokens = int(payload.get("max_tokens") or int(os.environ.get("MLX_MAX_TOKENS", "256")))
        temperature = float(payload.get("temperature") or float(os.environ.get("MLX_TEMPERATURE", "0.2")))
        top_p = float(payload.get("top_p") or float(os.environ.get("MLX_TOP_P", "0.9")))

        try:
            prompt = _build_prompt(self.server.tokenizer, messages)  # type: ignore[attr-defined]
            with self.server.lock:  # type: ignore[attr-defined]
                content = _generate(self.server.model, self.server.tokenizer, prompt, max_tokens, temperature, top_p)  # type: ignore[attr-defined]
        except Exception as e:
            self._send(500, json.dumps({"error": f"generation failed: {e}"}).encode("utf-8"))
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
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
        }
        self._send(200, json.dumps(response).encode("utf-8"))

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        msg = fmt % args
        print(f"[mlx] {self.address_string()} {msg}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("MLX_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("MLX_PORT", "12345")))
    ap.add_argument(
        "--model",
        default=os.environ.get("MLX_MODEL", "mlx-community/Llama-3.2-3B-Instruct-4bit"),
    )
    args = ap.parse_args()

    print(f"[mlx] loading model: {args.model}")
    httpd: MlxServer = MlxServer((args.host, args.port), Handler, args.model)
    print(f"[mlx] listening: http://{args.host}:{args.port} (OpenAI-ish: /v1/chat/completions)")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
