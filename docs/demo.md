# Demo scripts

These sequences are designed to be copy/pasteable for a quick “wow” demo.

## 60 seconds (TTS + LLM)

```bash
bun run engine
```

In another terminal:

```bash
bun run tui
```

In the TUI:

- `/install kokomo --yes`
- `/service kokomo start`
- `/say hello from agentloop`

Then:

- `/install mlx --yes`
- `/service mlx start`
- Ask a question in chat (engine will use MLX while it’s running).

## VLM (server only)

```bash
bun run vlm:install -- --yes
bun run vlm:server
curl http://127.0.0.1:12346/health
```

The VLM wrapper accepts OpenAI-ish `messages` with `image_url` `data:` URLs.

