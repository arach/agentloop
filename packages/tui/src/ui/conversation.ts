import { StyledText, bg, bold, dim, fg, t } from "@opentui/core";
import type { Message } from "@agentloop/core";
import type { Theme } from "./theme.js";
import { formatTime, isLogLikeSystemMessage } from "./text.js";

export type ConversationStatus = "idle" | "thinking" | "streaming" | "tool_use" | "error";

export function renderConversation(opts: {
  theme: Theme;
  messages: Message[];
  sessionStatus: ConversationStatus;
  streamingContent: string;
  style?: "minimal" | "powerline";
}): StyledText {
  const { theme, messages, sessionStatus, streamingContent } = opts;
  const style = opts.style ?? "minimal";

  const chunks: any[] = [];
  const push = (st: StyledText) => {
    chunks.push(...st.chunks);
  };
  const pushLine = (st: StyledText) => {
    push(st);
    push(t`\n`);
  };

  const roleStyles = (role: "user" | "assistant" | "system") => {
    if (role === "user")
      return { glyph: "❯", prompt: theme.fg, label: theme.muted, body: theme.fg, header: theme.dim2 };
    if (role === "assistant")
      return { glyph: "➜", prompt: theme.muted, label: theme.muted, body: theme.fg, header: theme.dim2 };
    return { glyph: "·", prompt: theme.dim2, label: theme.dim2, body: theme.dim, header: theme.dim2 };
  };

  const segment = (label: string, colors: { fg: string; bg: string }) =>
    bg(colors.bg)(fg(colors.fg)(bold(` ${label} `)));
  const powerSep = fg(theme.dim2)("");

  const renderMessage = (m: Message) => {
    const body = m.content.trimEnd();

    // For system log output, don't add extra headers/timestamps that break up the log stream.
    if (m.role === "system" && isLogLikeSystemMessage(body)) {
      for (const line of (body || "").split(/\r?\n/)) {
        pushLine(t`${fg(theme.dim2)("· ")}${fg(theme.dim2)(line)}`);
      }
      return;
    }

    const s = roleStyles(m.role);
    const time = formatTime(m.timestamp);
    const title = m.role === "user" ? "you" : m.role === "assistant" ? "agent" : "loop";
    const indent = fg(theme.dim2)("  ");

    if (style === "powerline") {
      const tagColors =
        m.role === "user"
          ? { fg: theme.bg, bg: theme.fg }
          : m.role === "assistant"
            ? { fg: theme.bg, bg: theme.muted }
            : { fg: theme.bg, bg: theme.dim2 };
      pushLine(
        t`${segment(title, tagColors)}${powerSep}${segment(time, {
          fg: theme.bg,
          bg: theme.dim2,
        })}${fg(theme.dim2)(" ")}`
      );
    } else {
      pushLine(t`${fg(s.prompt)(s.glyph)} ${fg(s.label)(title)} ${fg(s.header)(dim(`· ${time}`))}`);
    }

    if (!body) {
      pushLine(t`${indent}${fg(s.body)(dim("(empty)"))}`);
      pushLine(t``);
      return;
    }

    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trimStart();
      const color = trimmed.startsWith("[image]") ? theme.muted : s.body;
      pushLine(t`${indent}${fg(color)(line)}`);
    }
    pushLine(t``);
  };

  for (const m of messages) renderMessage(m);

  if (sessionStatus === "streaming" && streamingContent.trim()) {
    const s = roleStyles("assistant");
    const indent = fg(theme.dim2)("  ");
    const stamp = `${formatTime(Date.now())} · streaming`;
    if (style === "powerline") {
      pushLine(
        t`${segment("agent", { fg: theme.bg, bg: theme.muted })}${powerSep}${segment(stamp, {
          fg: theme.bg,
          bg: theme.dim2,
        })}${fg(theme.dim2)(" ")}`
      );
    } else {
      pushLine(t`${fg(s.prompt)(s.glyph)} ${fg(s.label)("agent")} ${fg(s.header)(dim(`· ${stamp}`))}`);
    }
    for (const line of streamingContent.trimEnd().split(/\r?\n/)) pushLine(t`${indent}${fg(s.body)(line)}`);
    pushLine(t``);
  }

  return new StyledText(chunks);
}
