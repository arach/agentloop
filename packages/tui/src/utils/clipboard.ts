export async function tryCopyToClipboard(text: string): Promise<boolean> {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  const bytes = new TextEncoder().encode(trimmed);

  const platform = process.platform;
  const candidates: { cmd: string[]; input: "stdin" | "arg" }[] =
    platform === "darwin"
      ? [
          // Some launch contexts may have a restricted PATH; try absolute paths too.
          { cmd: ["pbcopy"], input: "stdin" },
          { cmd: ["/usr/bin/pbcopy"], input: "stdin" },
        ]
      : platform === "linux"
        ? [
            { cmd: ["wl-copy"], input: "stdin" },
            { cmd: ["/usr/bin/wl-copy"], input: "stdin" },
            { cmd: ["xclip", "-selection", "clipboard"], input: "stdin" },
            { cmd: ["/usr/bin/xclip", "-selection", "clipboard"], input: "stdin" },
            { cmd: ["xsel", "--clipboard", "--input"], input: "stdin" },
            { cmd: ["/usr/bin/xsel", "--clipboard", "--input"], input: "stdin" },
          ]
        : platform === "win32"
          ? [{ cmd: ["clip"], input: "stdin" }]
          : [];

  for (const c of candidates) {
    try {
      const proc = Bun.spawn({
        cmd: c.cmd,
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (proc.stdin) {
        // Bun types vary by version; support both FileSink-style and stream-style stdin.
        const stdin: any = proc.stdin as any;
        if (stdin && typeof stdin.getWriter === "function") {
          const writer = stdin.getWriter();
          await writer.write(bytes);
          await writer.close();
        } else if (stdin && typeof stdin.write === "function") {
          await stdin.write(bytes);
          if (typeof stdin.end === "function") await stdin.end();
        }
      }
      const code = await proc.exited;
      if (code === 0) return true;
    } catch {
      // try next
    }
  }

  return false;
}
