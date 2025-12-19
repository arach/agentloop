import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function validateDomain(input: string): string {
  const clean = input.toLowerCase().trim();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) throw new Error("invalid domain");
  return clean;
}

export async function fetchLogoToCache(opts: { domain: string; repoRoot?: string }): Promise<{
  domain: string;
  url: string;
  filePath: string;
  bytes: number;
  cached: boolean;
}> {
  const domain = validateDomain(opts.domain);
  const repoRoot = opts.repoRoot ?? process.cwd();
  const cacheDir = path.join(repoRoot, ".agentloop", "cache", "logos");
  await mkdir(cacheDir, { recursive: true });
  const target = path.join(cacheDir, `${domain.replace(/[^a-z0-9.-]/gi, "_")}.png`);

  try {
    const existing = Bun.file(target);
    if (await existing.exists()) {
      const size = (await existing.arrayBuffer()).byteLength;
      return { domain, url: `https://logo.clearbit.com/${domain}`, filePath: target, bytes: size, cached: true };
    }
  } catch {
    // ignore cache miss
  }

  const url = `https://logo.clearbit.com/${domain}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty response");
  await writeFile(target, buf);
  return { domain, url, filePath: target, bytes: buf.byteLength, cached: false };
}
