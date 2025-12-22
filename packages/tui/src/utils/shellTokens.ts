export type ShellToken = { value: string; start: number; end: number };

export function shellTokenize(input: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;
  let tokenStart: number | null = null;

  const push = (end: number) => {
    if (tokenStart === null) return;
    tokens.push({ value: current, start: tokenStart, end });
    current = "";
    tokenStart = null;
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] ?? "";

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      if (tokenStart === null) tokenStart = i;
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      if (tokenStart === null) tokenStart = i;
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      push(i);
      continue;
    }

    if (tokenStart === null) tokenStart = i;
    current += ch;
  }

  push(input.length);
  return tokens;
}
