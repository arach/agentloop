export const SERVICE_NAMES = ["kokomo", "chatterbox", "mlx", "vlm"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export type ServiceStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface ServiceState {
  name: ServiceName;
  status: ServiceStatus;
  pid?: number;
  detail?: string;
  lastExitCode?: number;
  lastError?: string;
}

export type ServiceKind = "tts" | "llm" | "vlm";

export type ServiceDescriptor = {
  name: ServiceName;
  title: string;
  summary: string;
  kind: ServiceKind;
  short: string;
  defaultHost: string;
  defaultPort: number;
  installCommand: string;
  startCommand: string;
  installCheckPath: string;
};

const DEFAULT_HOST = "127.0.0.1";

export const SERVICE_DEFINITIONS: ServiceDescriptor[] = [
  {
    name: "kokomo",
    title: "Kokomo TTS",
    summary: "local TTS (mlx-audio[tts])",
    kind: "tts",
    short: "k",
    defaultHost: DEFAULT_HOST,
    defaultPort: 8880,
    installCommand: "/install kokomo --yes",
    startCommand: "/service kokomo start",
    installCheckPath: "external/kokomo-mlx/.venv/bin/python",
  },
  {
    name: "chatterbox",
    title: "Chatterbox TTS",
    summary: "local TTS (voice cloning)",
    kind: "tts",
    short: "c",
    defaultHost: DEFAULT_HOST,
    defaultPort: 8890,
    installCommand: "/install chatterbox --yes",
    startCommand: "/service chatterbox start",
    installCheckPath: "external/chatterbox-tts/.venv/bin/python",
  },
  {
    name: "mlx",
    title: "MLX LLM",
    summary: "local LLM (mlx-lm)",
    kind: "llm",
    short: "m",
    defaultHost: DEFAULT_HOST,
    defaultPort: 12345,
    installCommand: "/install mlx --yes",
    startCommand: "/service mlx start",
    installCheckPath: "external/mlx-llm/.venv/bin/python",
  },
  {
    name: "vlm",
    title: "MLX VLM",
    summary: "local VLM (mlx-vlm)",
    kind: "vlm",
    short: "v",
    defaultHost: DEFAULT_HOST,
    defaultPort: 12346,
    installCommand: "/install vlm --yes",
    startCommand: "/service vlm start",
    installCheckPath: "external/mlx-vlm/.venv/bin/python",
  },
];

export const SERVICE_BY_NAME: Record<ServiceName, ServiceDescriptor> = SERVICE_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.name] = def;
    return acc;
  },
  {} as Record<ServiceName, ServiceDescriptor>
);

export const SERVICE_PORTS: Record<ServiceName, number> = SERVICE_DEFINITIONS.reduce(
  (acc, def) => {
    acc[def.name] = def.defaultPort;
    return acc;
  },
  {} as Record<ServiceName, number>
);
