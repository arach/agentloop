import React, { memo } from "react";
import { Box, Text } from "ink";
import { theme, indicators } from "../theme.js";
import type { Message } from "@agentloop/core";

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MessageBubble = memo(function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
}: {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
  isStreaming?: boolean;
}) {
  const isUser = role === "user";
  const color = isUser ? theme.user : theme.assistant;
  const icon = isUser ? "◆" : "◇";
  const label = isUser ? "You" : "Agent";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header */}
      <Box>
        <Text color={color} bold>
          {icon} {label}
        </Text>
        {timestamp && (
          <>
            <Text color={theme.textDim}> {indicators.dot} </Text>
            <Text color={theme.textDim}>{formatTime(timestamp)}</Text>
          </>
        )}
        {isStreaming && (
          <Text color={theme.accent}> ...</Text>
        )}
      </Box>

      {/* Content */}
      <Box paddingLeft={2}>
        <Text color={theme.text} wrap="wrap">
          {content}
          {isStreaming && <Text color={theme.accent}>▌</Text>}
        </Text>
      </Box>
    </Box>
  );
});

const EmptyState = memo(function EmptyState() {
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      paddingY={4}
    >
      <Box flexDirection="column">
        <Text color={theme.primary}>╭─────────────────────────────────╮</Text>
        <Text color={theme.primary}>│                                 │</Text>
        <Text color={theme.primary}>
          │  <Text color={theme.text}>Welcome to AgentLoop!</Text>{"        "}│
        </Text>
        <Text color={theme.primary}>│                                 │</Text>
        <Text color={theme.primary}>
          │  <Text color={theme.textMuted}>Type a message to begin...</Text>{"   "}│
        </Text>
        <Text color={theme.primary}>│                                 │</Text>
        <Text color={theme.primary}>╰─────────────────────────────────╯</Text>
      </Box>
    </Box>
  );
});

export const MessageList = memo(function MessageList({
  messages,
  streamingContent,
  isStreaming,
}: MessageListProps) {
  if (messages.length === 0 && !isStreaming) {
    return <EmptyState />;
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          role={message.role as "user" | "assistant"}
          content={message.content}
          timestamp={message.timestamp}
        />
      ))}

      {isStreaming && streamingContent && (
        <MessageBubble
          role="assistant"
          content={streamingContent}
          isStreaming
        />
      )}
    </Box>
  );
});
