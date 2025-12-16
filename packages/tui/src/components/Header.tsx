import React, { memo } from "react";
import { Box, Text } from "ink";
import { theme, indicators, box } from "../theme.js";
import type { ConnectionStatus } from "../hooks/useEngine.js";
import type { Session } from "@agentloop/core";

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  sessionStatus: Session["status"];
  sessionId: string | null;
}

export const Header = memo(function Header({
  connectionStatus,
  sessionStatus,
  sessionId,
}: HeaderProps) {
  const connectionColor =
    connectionStatus === "connected"
      ? theme.success
      : connectionStatus === "connecting"
        ? theme.warning
        : theme.error;

  const connectionIcon =
    connectionStatus === "connected"
      ? indicators.connected
      : indicators.disconnected;

  const statusConfig = {
    idle: { text: "Ready", color: theme.success },
    thinking: { text: "Thinking...", color: theme.warning },
    streaming: { text: "Streaming", color: theme.accent },
    tool_use: { text: "Using tools", color: theme.info },
    error: { text: "Error", color: theme.error },
  }[sessionStatus];

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.border}>
          {box.topLeft}{box.horizontal.repeat(78)}{box.topRight}
        </Text>
      </Box>

      <Box>
        <Text color={theme.border}>{box.vertical}</Text>
        <Box width={78} paddingX={1}>
          <Box flexGrow={1}>
            <Text color={theme.primary} bold>
              {indicators.spark} AgentLoop
            </Text>
            <Text color={theme.textDim}> v0.1.0</Text>
          </Box>

          <Box>
            <Text color={connectionColor}>{connectionIcon}</Text>
            <Text color={theme.textMuted}> {connectionStatus} </Text>
            <Text color={theme.textDim}>{indicators.dot} </Text>
            <Text color={statusConfig.color}>{statusConfig.text}</Text>
          </Box>
        </Box>
        <Text color={theme.border}>{box.vertical}</Text>
      </Box>

      <Box>
        <Text color={theme.border}>{box.vertical}</Text>
        <Box width={78} paddingX={1}>
          <Text color={theme.textDim}>
            Session: {sessionId ? sessionId.slice(0, 8) : "none"}
          </Text>
        </Box>
        <Text color={theme.border}>{box.vertical}</Text>
      </Box>

      <Box>
        <Text color={theme.border}>
          {box.bottomLeft}{box.horizontal.repeat(78)}{box.bottomRight}
        </Text>
      </Box>
    </Box>
  );
});
