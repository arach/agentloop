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
}): StyledText {
  const { theme, messages, sessionStatus, streamingContent } = opts;

  const chunks: any[] = [];
  const push = (st: StyledText) => {
    chunks.push(...st.chunks);
  };
  const pushLine = (st: StyledText) => {
    push(st);
    push(t`\n`);
  };

  const tag = (label: string, colors: { fg: string; bg: string }) =>
    bg(colors.bg)(fg(colors.fg)(bold(` ${label} `)));

  const roleStyles = (role: "user" | "assistant" | "system") => {
    if (role === "user") return { tag: { fg: theme.bg, bg: theme.fg }, body: theme.fg, header: theme.muted };
    if (role === "assistant") return { tag: { fg: theme.bg, bg: theme.muted }, body: theme.fg, header: theme.muted };
    return { tag: { fg: theme.bg, bg: theme.dim2 }, body: theme.dim, header: theme.dim2 };
  };

  const renderMessage = (m: Message) => {
    const body = m.content.trimEnd();

    // For system log output, don't add extra headers/timestamps that break up the log stream.
    if (m.role === "system" && isLogLikeSystemMessage(body)) {
      for (const line of (body || "").split(/\r?\n/)) {
        pushLine(t`${fg(theme.dim2)(line)}`);
      }
      return;
    }

    const s = roleStyles(m.role);
    const time = formatTime(m.timestamp);
    const title = m.role === "user" ? "YOU" : m.role === "assistant" ? "AGENT" : "LOOP";

    pushLine(t`${tag(title, s.tag)} ${fg(s.header)(dim(time))}`);

    if (!body) {
      pushLine(t`${fg(s.body)(dim("(empty)"))}`);
      pushLine(t``);
      return;
    }

    for (const line of body.split(/\r?\n/)) {
      pushLine(t`${fg(s.body)(line)}`);
    }
    pushLine(t``);
  };

  for (const m of messages) renderMessage(m);

  if (sessionStatus === "streaming" && streamingContent.trim()) {
    const s = roleStyles("assistant");
    pushLine(t`${tag("AGENT", s.tag)} ${fg(s.header)(dim(formatTime(Date.now())))} ${fg(theme.dim2)("(streaming)")}`);
    for (const line of streamingContent.trimEnd().split(/\r?\n/)) {
      pushLine(t`${fg(s.body)(line)}`);
    }
    pushLine(t``);
  }

  return new StyledText(chunks);
}

