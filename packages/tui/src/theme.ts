// AgentLoop Theme - Inspired by modern terminal aesthetics

export const theme = {
  // Primary colors
  primary: "#7C3AED",      // Violet
  primaryBright: "#A78BFA",

  // Accent colors
  accent: "#06B6D4",       // Cyan
  accentBright: "#22D3EE",

  // Status colors
  success: "#10B981",      // Emerald
  warning: "#F59E0B",      // Amber
  error: "#EF4444",        // Red
  info: "#3B82F6",         // Blue

  // Neutral colors
  text: "#F9FAFB",         // Almost white
  textMuted: "#9CA3AF",    // Gray
  textDim: "#6B7280",      // Darker gray

  // Backgrounds
  bg: "#0F0F0F",
  bgPanel: "#1A1A1A",
  bgHighlight: "#262626",

  // Borders
  border: "#374151",
  borderFocus: "#7C3AED",

  // Semantic
  user: "#3B82F6",         // Blue for user messages
  assistant: "#10B981",    // Green for assistant
  system: "#F59E0B",       // Amber for system
} as const;

export type Theme = typeof theme;

// Gradient characters for fancy effects
export const gradientChars = ["░", "▒", "▓", "█"];

// Box drawing characters
export const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  horizontalBold: "━",
  verticalBold: "┃",
} as const;

// Status indicators
export const indicators = {
  connected: "●",
  disconnected: "○",
  loading: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  arrow: "❯",
  dot: "•",
  spark: "✦",
} as const;
