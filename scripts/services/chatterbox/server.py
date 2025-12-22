#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import List

import numpy as np
import torch


MODEL = None
MODEL_SR = None
DEVICE = "cpu"


def _pick_device() -> str:
    device = os.environ.get("CHATTERBOX_DEVICE", "cpu").lower()
    if device == "auto":
        if torch.cuda.is_available():
            return "cuda"
        # Chatterbox currently has MPS instability; default to CPU.
        if torch.backends.mps.is_available():
            return "cpu"
        return "cpu"
    if device == "cuda" and torch.cuda.is_available():
        return "cuda"
    if device == "mps" and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_model() -> None:
    global MODEL, MODEL_SR, DEVICE
    if MODEL is not None:
        return

    DEVICE = _pick_device()

    try:
        try:
            from chatterbox.src.chatterbox.tts import ChatterboxTTS
        except Exception:
            from chatterbox import ChatterboxTTS
    except Exception as e:
        raise RuntimeError("chatterbox-tts is not installed. Run: bun run chatterbox:install -- --yes") from e

    model = ChatterboxTTS.from_pretrained("cpu")

    if DEVICE != "cpu":
        try:
            if hasattr(model, "t3") and model.t3 is not None:
                model.t3 = model.t3.to(DEVICE)
            if hasattr(model, "s3gen") and model.s3gen is not None:
                model.s3gen = model.s3gen.to(DEVICE)
            if hasattr(model, "ve") and model.ve is not None:
                model.ve = model.ve.to(DEVICE)
            if hasattr(model, "device"):
                model.device = DEVICE
        except Exception:
            DEVICE = "cpu"
            if hasattr(model, "device"):
                model.device = DEVICE

    MODEL = model
    MODEL_SR = getattr(model, "sr", None)


def _split_text(text: str, max_chars: int) -> List[str]:
    if len(text) <= max_chars:
        return [text]

    import re

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""

            parts = re.split(r"(?<=,)\s+", sentence)
            for part in parts:
                if len(part) > max_chars:
                    words = part.split()
                    word_chunk = ""
                    for word in words:
                        if len(word_chunk + " " + word) <= max_chars:
                            word_chunk = (word_chunk + " " + word).strip()
                        else:
                            if word_chunk:
                                chunks.append(word_chunk.strip())
                            word_chunk = word
                    if word_chunk:
                        chunks.append(word_chunk.strip())
                else:
                    if len(current + " " + part) <= max_chars:
                        current = (current + " " + part).strip()
                    else:
                        if current:
                            chunks.append(current.strip())
                        current = part
        else:
            if len(current + " " + sentence) <= max_chars:
                current = (current + " " + sentence).strip()
            else:
                if current:
                    chunks.append(current.strip())
                current = sentence

    if current:
        chunks.append(current.strip())

    return [c for c in chunks if c.strip()]


def _generate_wav(text: str, audio_prompt_path: str | None, exaggeration: float, temperature: float, cfg_weight: float, chunk_size: int):
    _load_model()
    if MODEL is None:
        raise RuntimeError("Model failed to load")

    chunks = _split_text(text, chunk_size)
    wavs = []

    for chunk in chunks:
        wav = MODEL.generate(
            chunk,
            audio_prompt_path=audio_prompt_path,
            exaggeration=exaggeration,
            temperature=temperature,
            cfg_weight=cfg_weight,
        )
        wavs.append(wav)

    if len(wavs) == 1:
        return wavs[0]

    silence_samples = int(0.3 * (MODEL_SR or 24000))
    silence = torch.zeros(1, silence_samples, dtype=wavs[0].dtype)
    if wavs[0].device.type != "cpu":
        silence = silence.to(wavs[0].device)

    combined = wavs[0]
    for wav in wavs[1:]:
        combined = torch.cat([combined, silence, wav], dim=1)
    return combined


class Handler(BaseHTTPRequestHandler):
    server_version = "agentloop-chatterbox-tts/0.1"

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
            self._send(200, b"agentloop chatterbox tts server\n")
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
        audio_prompt_path = None
        exaggeration = float(os.environ.get("CHATTERBOX_EXAGGERATION", "1.0"))
        temperature = float(os.environ.get("CHATTERBOX_TEMPERATURE", "0.7"))
        cfg_weight = float(os.environ.get("CHATTERBOX_CFG_WEIGHT", "0.5"))
        chunk_size = int(os.environ.get("CHATTERBOX_CHUNK_SIZE", "250"))

        if "application/json" in content_type:
            try:
                payload = json.loads(raw.decode("utf-8") if raw else "{}")
                text = str(payload.get("text") or payload.get("input") or "")
                audio_prompt_path = payload.get("audio_prompt_path") or payload.get("voice")
                if payload.get("exaggeration") is not None:
                    exaggeration = float(payload.get("exaggeration"))
                if payload.get("temperature") is not None:
                    temperature = float(payload.get("temperature"))
                if payload.get("cfg_weight") is not None:
                    cfg_weight = float(payload.get("cfg_weight"))
                if payload.get("chunk_size") is not None:
                    chunk_size = int(payload.get("chunk_size"))
            except Exception as e:
                self._send(400, f"invalid json: {e}\n".encode("utf-8"))
                return
        else:
            text = raw.decode("utf-8", errors="replace")

        text = text.strip()
        if not text:
            self._send(400, b"missing text\n")
            return

        try:
            wav = _generate_wav(text, audio_prompt_path, exaggeration, temperature, cfg_weight, chunk_size)
            wav = wav.detach().cpu()
            if wav.dim() == 1:
                wav = wav.unsqueeze(0)
        except Exception as e:
            self._send(500, f"tts failed: {e}\n".encode("utf-8"))
            return

        try:
            import torchaudio
        except Exception as e:
            self._send(500, f"torchaudio not available: {e}\n".encode("utf-8"))
            return

        with tempfile.TemporaryDirectory(prefix="agentloop-chatterbox-") as tmpdir:
            out_path = os.path.join(tmpdir, "out.wav")
            sr = int(MODEL_SR or 24000)
            torchaudio.save(out_path, wav, sr)
            with open(out_path, "rb") as f:
                audio = f.read()

        self._send(200, audio, content_type="audio/wav")

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        msg = fmt % args
        print(f"[chatterbox] {self.address_string()} {msg}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("CHATTERBOX_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("CHATTERBOX_PORT", "8890")))
    args = ap.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[chatterbox] listening: http://{args.host}:{args.port} (/tts)")
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
