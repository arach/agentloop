export function shellSplit(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  const push = () => {
    if (current.length > 0) args.push(current);
    current = "";
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? "";
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
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
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      push();
      continue;
    }

    current += ch;
  }

  push();
  return args;
}

