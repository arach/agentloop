import { SERVICE_BY_NAME, type ServiceName, type ServiceState } from "@agentloop/core";
import { ManagedProcess } from "./ManagedProcess.js";
import { shellSplit } from "./shellSplit.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envBool, envNumber } from "../utils/env.js";

type ServiceEvent =
  | { type: "status"; service: ServiceState }
  | { type: "log"; name: ServiceName; stream: "stdout" | "stderr"; line: string };

type Listener = (event: ServiceEvent) => void;

type KokomoConfig = {
  cmd: string[];
  healthUrl?: string;
  readyTimeoutMs: number;
  autoStart: boolean;
};

type ChatterboxConfig = {
  cmd: string[];
  healthUrl?: string;
  readyTimeoutMs: number;
  autoStart: boolean;
};

type MlxConfig = {
  cmd: string[];
  healthUrl?: string;
  readyTimeoutMs: number;
  autoStart: boolean;
};

type VlmConfig = {
  cmd: string[];
  healthUrl?: string;
  readyTimeoutMs: number;
  autoStart: boolean;
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

const serviceDefaults = {
  kokomo: {
    scriptPath: path.join(repoRoot, "scripts/services/kokomo/run-server.sh"),
    venvPython: path.join(repoRoot, "external/kokomo-mlx/.venv/bin/python"),
  },
  chatterbox: {
    scriptPath: path.join(repoRoot, "scripts/services/chatterbox/run-server.sh"),
    venvPython: path.join(repoRoot, "external/chatterbox-tts/.venv/bin/python"),
  },
  mlx: {
    scriptPath: path.join(repoRoot, "scripts/services/mlx/run-server.sh"),
    venvPython: path.join(repoRoot, "external/mlx-llm/.venv/bin/python"),
  },
  vlm: {
    scriptPath: path.join(repoRoot, "scripts/services/vlm/run-server.sh"),
    venvPython: path.join(repoRoot, "external/mlx-vlm/.venv/bin/python"),
  },
} as const;

function parseCommandFromEnv(jsonKey: string, stringKey: string): string[] {
  const cmdJson = process.env[jsonKey];
  const cmdStr = process.env[stringKey];
  if (cmdJson) {
    const parsed = JSON.parse(cmdJson);
    if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) {
      throw new Error(`${jsonKey} must be a JSON array of strings.`);
    }
    return parsed;
  }
  if (cmdStr) return shellSplit(cmdStr);
  return [];
}

function kokomoConfigFromEnv(): KokomoConfig {
  const cmd = parseCommandFromEnv("KOKOMO_CMD_JSON", "KOKOMO_CMD");
  const { scriptPath, venvPython } = serviceDefaults.kokomo;

  const kokomoLocal = envBool("AGENTLOOP_KOKOMO_LOCAL", false);
  const useDefaults = envBool("KOKOMO_USE_DEFAULTS", kokomoLocal) || kokomoLocal;

  // Sensible defaults:
  // - If user explicitly opts in (AGENTLOOP_KOKOMO_LOCAL or KOKOMO_USE_DEFAULTS), use the wrapper script if present.
  // - If not opted in, still auto-wire defaults once the venv exists (post-install), so `/service kokomo start` just works.
  const canUseWrapper = existsSync(scriptPath) && existsSync(venvPython);
  const shouldUseWrapper = cmd.length === 0 && (useDefaults || canUseWrapper);
  if (shouldUseWrapper) cmd = ["bash", scriptPath];

  const defaults = SERVICE_BY_NAME.kokomo;
  const host = process.env.KOKOMO_HOST ?? defaults.defaultHost;
  const port = process.env.KOKOMO_PORT ?? String(defaults.defaultPort);
  return {
    cmd,
    healthUrl: process.env.KOKOMO_HEALTH_URL ?? (cmd.length > 0 ? `http://${host}:${port}/health` : undefined),
    readyTimeoutMs: envNumber("KOKOMO_READY_TIMEOUT_MS", 15_000),
    autoStart: envBool("AGENTLOOP_MANAGE_KOKOMO", false),
  };
}

function chatterboxConfigFromEnv(): ChatterboxConfig {
  const cmd = parseCommandFromEnv("CHATTERBOX_CMD_JSON", "CHATTERBOX_CMD");
  const { scriptPath, venvPython } = serviceDefaults.chatterbox;
  const canUseWrapper = existsSync(scriptPath) && existsSync(venvPython);
  if (cmd.length === 0 && canUseWrapper) cmd = ["bash", scriptPath];

  const defaults = SERVICE_BY_NAME.chatterbox;
  const host = process.env.CHATTERBOX_HOST ?? defaults.defaultHost;
  const port = process.env.CHATTERBOX_PORT ?? String(defaults.defaultPort);
  return {
    cmd,
    healthUrl: process.env.CHATTERBOX_HEALTH_URL ?? (cmd.length > 0 ? `http://${host}:${port}/health` : undefined),
    readyTimeoutMs: envNumber("CHATTERBOX_READY_TIMEOUT_MS", 30_000),
    autoStart: envBool("AGENTLOOP_MANAGE_CHATTERBOX", false),
  };
}

function mlxConfigFromEnv(): MlxConfig {
  const cmd = parseCommandFromEnv("MLX_CMD_JSON", "MLX_CMD");
  const { scriptPath, venvPython } = serviceDefaults.mlx;

  // Sensible defaults:
  // - If not configured, use the wrapper script once the venv exists (post-install).
  const canUseWrapper = existsSync(scriptPath) && existsSync(venvPython);
  if (cmd.length === 0 && canUseWrapper) cmd = ["bash", scriptPath];

  const defaults = SERVICE_BY_NAME.mlx;
  const host = process.env.MLX_HOST ?? defaults.defaultHost;
  const port = process.env.MLX_PORT ?? String(defaults.defaultPort);
  return {
    cmd,
    healthUrl: process.env.MLX_HEALTH_URL ?? (cmd.length > 0 ? `http://${host}:${port}/health` : undefined),
    readyTimeoutMs: envNumber("MLX_READY_TIMEOUT_MS", 30_000),
    // Dev-friendly default: if the built-in wrapper exists, manage it automatically.
    autoStart: envBool("AGENTLOOP_MANAGE_MLX", canUseWrapper),
  };
}

function vlmConfigFromEnv(): VlmConfig {
  const cmd = parseCommandFromEnv("VLM_CMD_JSON", "VLM_CMD");
  const { scriptPath, venvPython } = serviceDefaults.vlm;
  const canUseWrapper = existsSync(scriptPath) && existsSync(venvPython);
  if (cmd.length === 0 && canUseWrapper) cmd = ["bash", scriptPath];

  const defaults = SERVICE_BY_NAME.vlm;
  const host = process.env.VLM_HOST ?? defaults.defaultHost;
  const port = process.env.VLM_PORT ?? String(defaults.defaultPort);
  return {
    cmd,
    healthUrl: process.env.VLM_HEALTH_URL ?? (cmd.length > 0 ? `http://${host}:${port}/health` : undefined),
    readyTimeoutMs: envNumber("VLM_READY_TIMEOUT_MS", 30_000),
    autoStart: envBool("AGENTLOOP_MANAGE_VLM", false),
  };
}

async function waitForHealthy(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return;
      lastErr = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(250);
  }
  throw new Error(`Health check failed (${url}): ${lastErr || "timeout"}`);
}

async function isHealthy(url: string, timeoutMs = 250): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export class ServiceManager {
  #listeners = new Set<Listener>();

  #kokomoCfg: KokomoConfig;
  #kokomoProc: ManagedProcess | null = null;
  #kokomoState: ServiceState = { name: "kokomo", status: "stopped" };

  #chatterboxCfg: ChatterboxConfig;
  #chatterboxProc: ManagedProcess | null = null;
  #chatterboxState: ServiceState = { name: "chatterbox", status: "stopped" };

  #mlxCfg: MlxConfig;
  #mlxProc: ManagedProcess | null = null;
  #mlxState: ServiceState = { name: "mlx", status: "stopped" };

  #vlmCfg: VlmConfig;
  #vlmProc: ManagedProcess | null = null;
  #vlmState: ServiceState = { name: "vlm", status: "stopped" };

  constructor() {
    this.#kokomoCfg = kokomoConfigFromEnv();
    this.#chatterboxCfg = chatterboxConfigFromEnv();
    this.#mlxCfg = mlxConfigFromEnv();
    this.#vlmCfg = vlmConfigFromEnv();
  }

  on(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event: ServiceEvent) {
    for (const l of this.#listeners) l(event);
  }

  getState(name: ServiceName): ServiceState {
    if (name === "kokomo") return this.#kokomoState;
    if (name === "chatterbox") return this.#chatterboxState;
    if (name === "mlx") return this.#mlxState;
    if (name === "vlm") return this.#vlmState;
    return { name, status: "error", lastError: "Unknown service" } as ServiceState;
  }

  listStates(): ServiceState[] {
    return [this.#kokomoState, this.#chatterboxState, this.#mlxState, this.#vlmState];
  }

  canStart(name: ServiceName): boolean {
    if (name === "kokomo") return kokomoConfigFromEnv().cmd.length > 0;
    if (name === "chatterbox") return chatterboxConfigFromEnv().cmd.length > 0;
    if (name === "mlx") return mlxConfigFromEnv().cmd.length > 0;
    if (name === "vlm") return vlmConfigFromEnv().cmd.length > 0;
    return false;
  }

  async isServiceHealthy(name: ServiceName, timeoutMs = 250): Promise<boolean> {
    if (name === "kokomo") {
      this.#kokomoCfg = kokomoConfigFromEnv();
      return this.#kokomoCfg.healthUrl ? isHealthy(this.#kokomoCfg.healthUrl, timeoutMs) : false;
    }
    if (name === "chatterbox") {
      this.#chatterboxCfg = chatterboxConfigFromEnv();
      return this.#chatterboxCfg.healthUrl ? isHealthy(this.#chatterboxCfg.healthUrl, timeoutMs) : false;
    }
    if (name === "mlx") {
      this.#mlxCfg = mlxConfigFromEnv();
      return this.#mlxCfg.healthUrl ? isHealthy(this.#mlxCfg.healthUrl, timeoutMs) : false;
    }
    if (name === "vlm") {
      this.#vlmCfg = vlmConfigFromEnv();
      return this.#vlmCfg.healthUrl ? isHealthy(this.#vlmCfg.healthUrl, timeoutMs) : false;
    }
    return false;
  }

  async start(name: ServiceName): Promise<void> {
    if (name === "kokomo") {
      // Re-read env/config at start time so users can set env vars without restarting the engine.
      this.#kokomoCfg = kokomoConfigFromEnv();
      const current = this.#kokomoState.status;
      if (current === "running" || current === "starting") return;

      if (this.#kokomoCfg.cmd.length === 0) {
        throw new Error(
          [
            "Kokomo is not configured/installed.",
            "",
            "If you want the built-in local MLX wrapper:",
            "  1) bun run kokomo:install -- --yes",
            "  2) then in the TUI: /service kokomo start",
            "",
            "Or provide your own command:",
            "  - set KOKOMO_CMD or KOKOMO_CMD_JSON",
          ].join("\n")
        );
      }

      this.#kokomoState = { ...this.#kokomoState, status: "starting", detail: "Starting..." };
      this.#emit({ type: "status", service: this.#kokomoState });

      const proc = new ManagedProcess("kokomo", this.#kokomoCfg.cmd, {
        inheritStdio: false,
        onLine: (stream, line) => this.#emit({ type: "log", name: "kokomo", stream, line }),
        onExit: (code) => {
          const wasStopping = this.#kokomoState.status === "stopping";
          this.#kokomoProc = null;
          this.#kokomoState = {
            ...this.#kokomoState,
            status: "stopped",
            pid: undefined,
            detail: wasStopping ? "Stopped" : "Exited",
            lastExitCode: code,
            lastError: wasStopping ? undefined : `Exited with code ${code}`,
          };
          this.#emit({ type: "status", service: this.#kokomoState });
        },
      });

      this.#kokomoProc = proc;
      proc.start();
      this.#kokomoState = { ...this.#kokomoState, pid: proc.pid ?? undefined };
      this.#emit({ type: "status", service: this.#kokomoState });

      try {
        if (this.#kokomoCfg.healthUrl) {
          this.#kokomoState = { ...this.#kokomoState, detail: "Waiting for readiness..." };
          this.#emit({ type: "status", service: this.#kokomoState });
          await waitForHealthy(this.#kokomoCfg.healthUrl, this.#kokomoCfg.readyTimeoutMs);
        }
        this.#kokomoState = { ...this.#kokomoState, status: "running", detail: "Running", lastError: undefined };
        this.#emit({ type: "status", service: this.#kokomoState });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.#kokomoState = { ...this.#kokomoState, status: "error", detail: "Failed to start", lastError: msg };
        this.#emit({ type: "status", service: this.#kokomoState });
        await this.stop("kokomo");
        throw err;
      }
      return;
    }

    if (name === "chatterbox") {
      this.#chatterboxCfg = chatterboxConfigFromEnv();
      const current = this.#chatterboxState.status;
      if (current === "running" || current === "starting") return;

      if (this.#chatterboxCfg.cmd.length === 0) {
        throw new Error(
          [
            "Chatterbox TTS is not configured/installed.",
            "",
            "To install the built-in wrapper:",
            "  1) bun run chatterbox:install -- --yes",
            "  2) then in the TUI: /service chatterbox start",
            "",
            "Or provide your own command:",
            "  - set CHATTERBOX_CMD or CHATTERBOX_CMD_JSON",
          ].join("\n")
        );
      }

      if (this.#chatterboxCfg.healthUrl && (await isHealthy(this.#chatterboxCfg.healthUrl, 300))) {
        this.#chatterboxState = {
          ...this.#chatterboxState,
          status: "running",
          detail: "Running (external)",
          pid: undefined,
          lastError: undefined,
        };
        this.#emit({ type: "status", service: this.#chatterboxState });
        return;
      }

      this.#chatterboxState = { ...this.#chatterboxState, status: "starting", detail: "Starting..." };
      this.#emit({ type: "status", service: this.#chatterboxState });

      const proc = new ManagedProcess("chatterbox", this.#chatterboxCfg.cmd, {
        inheritStdio: false,
        onLine: (stream, line) => this.#emit({ type: "log", name: "chatterbox", stream, line }),
        onExit: (code) => {
          const wasStopping = this.#chatterboxState.status === "stopping";
          this.#chatterboxProc = null;
          this.#chatterboxState = {
            ...this.#chatterboxState,
            status: "stopped",
            pid: undefined,
            detail: wasStopping ? "Stopped" : "Exited",
            lastExitCode: code,
            lastError: wasStopping ? undefined : `Exited with code ${code}`,
          };
          this.#emit({ type: "status", service: this.#chatterboxState });
        },
      });

      this.#chatterboxProc = proc;
      proc.start();
      this.#chatterboxState = { ...this.#chatterboxState, pid: proc.pid ?? undefined };
      this.#emit({ type: "status", service: this.#chatterboxState });

      try {
        if (this.#chatterboxCfg.healthUrl) {
          this.#chatterboxState = { ...this.#chatterboxState, detail: "Waiting for readiness..." };
          this.#emit({ type: "status", service: this.#chatterboxState });
          await waitForHealthy(this.#chatterboxCfg.healthUrl, this.#chatterboxCfg.readyTimeoutMs);
        }
        this.#chatterboxState = { ...this.#chatterboxState, status: "running", detail: "Running", lastError: undefined };
        this.#emit({ type: "status", service: this.#chatterboxState });
      } catch (err) {
        if (this.#chatterboxCfg.healthUrl && (await isHealthy(this.#chatterboxCfg.healthUrl, 300))) {
          this.#chatterboxState = {
            ...this.#chatterboxState,
            status: "running",
            detail: "Running (external)",
            pid: undefined,
            lastError: undefined,
          };
          this.#emit({ type: "status", service: this.#chatterboxState });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.#chatterboxState = { ...this.#chatterboxState, status: "error", detail: "Failed to start", lastError: msg };
        this.#emit({ type: "status", service: this.#chatterboxState });
        await this.stop("chatterbox");
        throw err;
      }
      return;
    }

    if (name === "mlx") {
      this.#mlxCfg = mlxConfigFromEnv();
      const current = this.#mlxState.status;
      if (current === "running" || current === "starting") return;

      if (this.#mlxCfg.cmd.length === 0) {
        throw new Error(
          [
            "MLX LLM is not configured/installed.",
            "",
            "To install the built-in MLX wrapper:",
            "  1) bun run mlx:install -- --yes",
            "  2) then in the TUI: /service mlx start",
            "",
            "Or provide your own command:",
            "  - set MLX_CMD or MLX_CMD_JSON",
          ].join("\n")
        );
      }

      // If MLX is already serving on the configured URL/port, treat it as running
      // rather than failing with an "address already in use" spawn.
      if (this.#mlxCfg.healthUrl && (await isHealthy(this.#mlxCfg.healthUrl, 300))) {
        this.#mlxState = { ...this.#mlxState, status: "running", detail: "Running (external)", pid: undefined, lastError: undefined };
        this.#emit({ type: "status", service: this.#mlxState });
        return;
      }

      this.#mlxState = { ...this.#mlxState, status: "starting", detail: "Starting..." };
      this.#emit({ type: "status", service: this.#mlxState });

      const proc = new ManagedProcess("mlx", this.#mlxCfg.cmd, {
        inheritStdio: false,
        onLine: (stream, line) => this.#emit({ type: "log", name: "mlx", stream, line }),
        onExit: (code) => {
          const wasStopping = this.#mlxState.status === "stopping";
          this.#mlxProc = null;
          this.#mlxState = {
            ...this.#mlxState,
            status: "stopped",
            pid: undefined,
            detail: wasStopping ? "Stopped" : "Exited",
            lastExitCode: code,
            lastError: wasStopping ? undefined : `Exited with code ${code}`,
          };
          this.#emit({ type: "status", service: this.#mlxState });
        },
      });

      this.#mlxProc = proc;
      proc.start();
      this.#mlxState = { ...this.#mlxState, pid: proc.pid ?? undefined };
      this.#emit({ type: "status", service: this.#mlxState });

      try {
        if (this.#mlxCfg.healthUrl) {
          this.#mlxState = { ...this.#mlxState, detail: "Waiting for readiness..." };
          this.#emit({ type: "status", service: this.#mlxState });
          await waitForHealthy(this.#mlxCfg.healthUrl, this.#mlxCfg.readyTimeoutMs);
        }
        this.#mlxState = { ...this.#mlxState, status: "running", detail: "Running", lastError: undefined };
        this.#emit({ type: "status", service: this.#mlxState });
      } catch (err) {
        // If start failed but the port is already serving, assume another process owns it.
        if (this.#mlxCfg.healthUrl && (await isHealthy(this.#mlxCfg.healthUrl, 300))) {
          this.#mlxState = { ...this.#mlxState, status: "running", detail: "Running (external)", pid: undefined, lastError: undefined };
          this.#emit({ type: "status", service: this.#mlxState });
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.#mlxState = { ...this.#mlxState, status: "error", detail: "Failed to start", lastError: msg };
        this.#emit({ type: "status", service: this.#mlxState });
        await this.stop("mlx");
        throw err;
      }
      return;
    }

    if (name === "vlm") {
      this.#vlmCfg = vlmConfigFromEnv();
      const current = this.#vlmState.status;
      if (current === "running" || current === "starting") return;

      if (this.#vlmCfg.cmd.length === 0) {
        throw new Error(
          [
            "MLX VLM is not configured/installed.",
            "",
            "To install the built-in MLX VLM wrapper:",
            "  1) bun run vlm:install -- --yes",
            "  2) then in the TUI: /service vlm start",
            "",
            "Or provide your own command:",
            "  - set VLM_CMD or VLM_CMD_JSON",
          ].join("\n")
        );
      }

      this.#vlmState = { ...this.#vlmState, status: "starting", detail: "Starting..." };
      this.#emit({ type: "status", service: this.#vlmState });

      const proc = new ManagedProcess("vlm", this.#vlmCfg.cmd, {
        inheritStdio: false,
        onLine: (stream, line) => this.#emit({ type: "log", name: "vlm", stream, line }),
        onExit: (code) => {
          const wasStopping = this.#vlmState.status === "stopping";
          this.#vlmProc = null;
          this.#vlmState = {
            ...this.#vlmState,
            status: "stopped",
            pid: undefined,
            detail: wasStopping ? "Stopped" : "Exited",
            lastExitCode: code,
            lastError: wasStopping ? undefined : `Exited with code ${code}`,
          };
          this.#emit({ type: "status", service: this.#vlmState });
        },
      });

      this.#vlmProc = proc;
      proc.start();
      this.#vlmState = { ...this.#vlmState, pid: proc.pid ?? undefined };
      this.#emit({ type: "status", service: this.#vlmState });

      try {
        if (this.#vlmCfg.healthUrl) {
          this.#vlmState = { ...this.#vlmState, detail: "Waiting for readiness..." };
          this.#emit({ type: "status", service: this.#vlmState });
          await waitForHealthy(this.#vlmCfg.healthUrl, this.#vlmCfg.readyTimeoutMs);
        }
        this.#vlmState = { ...this.#vlmState, status: "running", detail: "Running", lastError: undefined };
        this.#emit({ type: "status", service: this.#vlmState });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.#vlmState = { ...this.#vlmState, status: "error", detail: "Failed to start", lastError: msg };
        this.#emit({ type: "status", service: this.#vlmState });
        await this.stop("vlm");
        throw err;
      }
      return;
    }

    throw new Error(`Unknown service: ${name}`);
  }

  async stop(name: ServiceName): Promise<void> {
    if (name === "kokomo") {
      if (!this.#kokomoProc) {
        this.#kokomoState = { ...this.#kokomoState, status: "stopped", detail: "Stopped", pid: undefined };
        this.#emit({ type: "status", service: this.#kokomoState });
        return;
      }

      if (this.#kokomoState.status === "stopping") return;

      this.#kokomoState = { ...this.#kokomoState, status: "stopping", detail: "Stopping..." };
      this.#emit({ type: "status", service: this.#kokomoState });

      const proc = this.#kokomoProc;
      await proc.stop().catch(() => {});
      this.#kokomoProc = null;

      this.#kokomoState = { ...this.#kokomoState, status: "stopped", pid: undefined, detail: "Stopped" };
      this.#emit({ type: "status", service: this.#kokomoState });
      return;
    }

    if (name === "chatterbox") {
      if (!this.#chatterboxProc) {
        this.#chatterboxState = { ...this.#chatterboxState, status: "stopped", detail: "Stopped", pid: undefined };
        this.#emit({ type: "status", service: this.#chatterboxState });
        return;
      }

      if (this.#chatterboxState.status === "stopping") return;

      this.#chatterboxState = { ...this.#chatterboxState, status: "stopping", detail: "Stopping..." };
      this.#emit({ type: "status", service: this.#chatterboxState });

      const proc = this.#chatterboxProc;
      await proc.stop().catch(() => {});
      this.#chatterboxProc = null;

      this.#chatterboxState = { ...this.#chatterboxState, status: "stopped", pid: undefined, detail: "Stopped" };
      this.#emit({ type: "status", service: this.#chatterboxState });
      return;
    }

    if (name === "mlx") {
      if (!this.#mlxProc) {
        this.#mlxState = { ...this.#mlxState, status: "stopped", detail: "Stopped", pid: undefined };
        this.#emit({ type: "status", service: this.#mlxState });
        return;
      }

      if (this.#mlxState.status === "stopping") return;

      this.#mlxState = { ...this.#mlxState, status: "stopping", detail: "Stopping..." };
      this.#emit({ type: "status", service: this.#mlxState });

      const proc = this.#mlxProc;
      await proc.stop().catch(() => {});
      this.#mlxProc = null;

      this.#mlxState = { ...this.#mlxState, status: "stopped", pid: undefined, detail: "Stopped" };
      this.#emit({ type: "status", service: this.#mlxState });
      return;
    }

    if (name === "vlm") {
      if (!this.#vlmProc) {
        this.#vlmState = { ...this.#vlmState, status: "stopped", detail: "Stopped", pid: undefined };
        this.#emit({ type: "status", service: this.#vlmState });
        return;
      }

      if (this.#vlmState.status === "stopping") return;

      this.#vlmState = { ...this.#vlmState, status: "stopping", detail: "Stopping..." };
      this.#emit({ type: "status", service: this.#vlmState });

      const proc = this.#vlmProc;
      await proc.stop().catch(() => {});
      this.#vlmProc = null;

      this.#vlmState = { ...this.#vlmState, status: "stopped", pid: undefined, detail: "Stopped" };
      this.#emit({ type: "status", service: this.#vlmState });
      return;
    }

    throw new Error(`Unknown service: ${name}`);
  }

  async autoStartIfConfigured(): Promise<void> {
    // Re-read env/config at auto-start time so post-install defaults apply without restart.
    this.#kokomoCfg = kokomoConfigFromEnv();
    this.#chatterboxCfg = chatterboxConfigFromEnv();
    this.#mlxCfg = mlxConfigFromEnv();
    this.#vlmCfg = vlmConfigFromEnv();
    if (this.#kokomoCfg.autoStart) {
      await this.start("kokomo");
    }
    if (this.#chatterboxCfg.autoStart) {
      await this.start("chatterbox");
    }
    if (this.#mlxCfg.autoStart) {
      await this.start("mlx");
    }
    if (this.#vlmCfg.autoStart) {
      await this.start("vlm");
    }
  }
}
