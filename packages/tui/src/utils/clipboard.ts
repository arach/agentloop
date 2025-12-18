export async function tryCopyToClipboard(text: string): Promise<boolean> {
  const trimmed = text.trimEnd();
  if (!trimmed) return false;

  const platform = process.platform;
  const candidates: { cmd: string[]; input: "stdin" | "arg" }[] =
    platform === "darwin"
      ? [{ cmd: ["pbcopy"], input: "stdin" }]
      : platform === "linux"
        ? [
            { cmd: ["wl-copy"], input: "stdin" },
            { cmd: ["xclip", "-selection", "clipboard"], input: "stdin" },
            { cmd: ["xsel", "--clipboard", "--input"], input: "stdin" },
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
        await proc.stdin.write(trimmed);
        await proc.stdin.end();
      }
      const code = await proc.exited;
      if (code === 0) return true;
    } catch {
      // try next
    }
  }

  return false;
}
