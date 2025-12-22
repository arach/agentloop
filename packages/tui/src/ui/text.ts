export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

export function extractCodeBlocks(markdown: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  for (const m of normalizeNewlines(markdown).matchAll(re)) {
    blocks.push({ lang: (m[1] ?? "").trim(), code: (m[2] ?? "").trimEnd() });
  }
  return blocks;
}

export function maybeExtractPath(text: string): string | null {
  const m = text.match(/\b\/(?:[^\s]+\/)*[^\s]+\.(?:wav|mp3|m4a)\b/);
  return m?.[0] ?? null;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function clampLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  return lines.slice(lines.length - max);
}

export function isLogLikeSystemMessage(text: string): boolean {
  const first = (text ?? "").trimStart();
  if (!first) return false;
  if (first.startsWith("[install:")) return true;
  if (first.startsWith("[service]")) return true;
  if (first.startsWith("[tool]")) return true;
  if (first.startsWith("[say]")) return true;
  if (first.startsWith("[copy]")) return true;
  if (first.startsWith("$ ")) return true;
  if (first.startsWith("! ")) return true;
  if (first.startsWith("[kokomo]") || first.startsWith("[chatterbox]") || first.startsWith("[mlx]") || first.startsWith("[vlm]"))
    return true;
  // Generic bracketed log prefix: [something] ...
  if (/^\[[A-Za-z0-9_.:-]+\]/.test(first)) return true;
  return false;
}
