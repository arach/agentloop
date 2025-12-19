import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type Logger = {
  info: (msg: string) => void;
  error: (msg: string) => void;
  data: (label: string, payload: unknown) => void;
};

export function createLogger(opts: { repoRoot: string; fileName?: string; alsoConsole?: boolean }): Logger {
  const fileName = opts.fileName ?? ".agentloop/logs/agentloop.log";
  const logPath = path.join(opts.repoRoot, fileName);
  const prefix = () => new Date().toISOString();

  const write = async (level: "INFO" | "ERROR", msg: string) => {
    try {
      await mkdir(path.dirname(logPath), { recursive: true });
      await appendFile(logPath, `[${prefix()}] ${level} ${msg}\n`);
    } catch {
      // ignore logging failures
    }
    if (opts.alsoConsole || process.env.AGENTLOOP_DEBUG === "1") {
      const line = `[${level}] ${msg}`;
      if (level === "ERROR") console.error(line);
      else console.log(line);
    }
  };

  return {
    info: (msg: string) => {
      void write("INFO", msg);
    },
    error: (msg: string) => {
      void write("ERROR", msg);
    },
    data: (label: string, payload: unknown) => {
      const json = (() => {
        try {
          return JSON.stringify(payload);
        } catch {
          return String(payload);
        }
      })();
      void write("INFO", `${label}: ${json}`);
    },
  };
}
