export type ManagedProcessOptions = {
  cwd?: string;
  env?: Record<string, string>;
  inheritStdio?: boolean;
  onLine?: (stream: "stdout" | "stderr", line: string) => void;
  onExit?: (code: number) => void;
};

export class ManagedProcess {
  readonly name: string;
  readonly cmd: string[];
  readonly options: ManagedProcessOptions;
  #proc: Bun.Subprocess | null = null;
  #stopping = false;

  constructor(name: string, cmd: string[], options: ManagedProcessOptions = {}) {
    if (cmd.length === 0) throw new Error(`ManagedProcess "${name}" requires a command.`);
    this.name = name;
    this.cmd = cmd;
    this.options = options;
  }

  get running(): boolean {
    return this.#proc !== null;
  }

  get pid(): number | null {
    return this.#proc?.pid ?? null;
  }

  start(): void {
    if (this.#proc) return;

    const proc = Bun.spawn({
      cmd: this.cmd,
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdin: "ignore",
      stdout: this.options.inheritStdio ? "inherit" : "pipe",
      stderr: this.options.inheritStdio ? "inherit" : "pipe",
    });

    this.#proc = proc;
    this.#stopping = false;

    if (!this.options.inheritStdio) {
      const prefix = `[${this.name}] `;
      const pump = async (
        stream: ReadableStream<Uint8Array> | null | undefined,
        streamName: "stdout" | "stderr",
        write: (s: string) => void
      ) => {
        if (!stream) return;
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            const text = decoder.decode(value);
            const lines = text.split(/\r?\n/);
            for (const line of lines) {
              if (!line) continue;
              this.options.onLine?.(streamName, line);
              write(`${prefix}${line}\n`);
            }
          }
        } catch {
          // ignore
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }
      };

      void pump(proc.stdout, "stdout", (s) => process.stdout.write(s));
      void pump(proc.stderr, "stderr", (s) => process.stderr.write(s));
    }

    void proc.exited.then((code) => {
      this.#proc = null;
      this.options.onExit?.(code);
      if (this.#stopping) return;
      process.stderr.write(`[${this.name}] exited with code ${code}\n`);
    });
  }

  async stop(graceMs = 2_000): Promise<void> {
    if (!this.#proc) return;
    if (this.#stopping) return;
    this.#stopping = true;

    const proc = this.#proc;
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, graceMs);

    try {
      await proc.exited;
    } finally {
      clearTimeout(timer);
      if (this.#proc === proc) this.#proc = null;
    }
  }
}
