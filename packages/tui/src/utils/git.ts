export type GitRunResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function runGit(opts: { cwd: string; args: string[] }): Promise<GitRunResult> {
  const proc = Bun.spawn({
    cmd: ["git", ...opts.args],
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
    proc.exited,
  ]);

  const stdout = Buffer.from(stdoutBuf).toString("utf8");
  const stderr = Buffer.from(stderrBuf).toString("utf8");
  return { ok: exitCode === 0, exitCode, stdout, stderr };
}

