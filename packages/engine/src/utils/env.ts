export function envString(key: string): string | undefined {
  const raw = process.env[key];
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function envNumber(key: string, defaultValue?: number): number | undefined {
  const raw = envString(key);
  if (!raw) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

export function envBool(key: string, defaultValue = false): boolean {
  const raw = envString(key);
  if (!raw) return defaultValue;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}
