export type Theme = {
  bg: string;
  panelBg: string;
  panelBg2: string;
  border: string;
  borderFocused: string;
  fg: string;
  muted: string;
  dim: string;
  dim2: string;
  selectionBg: string;
  selectionFg: string;
};

export type ThemeName = "forge" | "forge-core" | "noir";

export const themes: Record<ThemeName, Theme> = {
  forge: {
    bg: "#0b1f25",
    panelBg: "#0f242b",
    panelBg2: "#102830",
    border: "#1d3138",
    borderFocused: "#3b6069",
    fg: "#d7e7ea",
    muted: "#9fb4bb",
    dim: "#6f8890",
    dim2: "#4f666e",
    selectionBg: "#223c44",
    selectionFg: "#e8f4f7",
  },
  "forge-core": {
    bg: "#0b1f2b",
    panelBg: "#0f2633",
    panelBg2: "#112d3b",
    border: "#1b3440",
    borderFocused: "#3a7a8c",
    fg: "#d7eef6",
    muted: "#98b6c1",
    dim: "#6f8c96",
    dim2: "#4f6b75",
    selectionBg: "#1f3b49",
    selectionFg: "#eef8fb",
  },
  noir: {
    bg: "#0a0a0a",
    panelBg: "#0e0e0e",
    panelBg2: "#101010",
    border: "#2e2e2e",
    borderFocused: "#a0a0a0",
    fg: "#f0f0f0",
    muted: "#b8b8b8",
    dim: "#7c7c7c",
    dim2: "#5c5c5c",
    selectionBg: "#2a2a2a",
    selectionFg: "#ffffff",
  },
};

const fromEnv = (process.env.AGENTLOOP_THEME ?? "").toLowerCase() as ThemeName;
export const theme: Theme = themes[fromEnv] ?? themes.forge;
