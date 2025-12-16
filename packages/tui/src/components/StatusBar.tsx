import React, { memo } from "react";
import { Box, Text } from "ink";
import { theme, indicators } from "../theme.js";
import type { ConnectionStatus } from "../hooks/useEngine.js";
import type { Session } from "@agentloop/core";

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
  sessionStatus: Session["status"];
}

export const StatusBar = memo(function StatusBar({
  connectionStatus,
  sessionStatus,
}: StatusBarProps) {
  const statusConfig = {
    idle: { icon: indicators.connected, text: "Ready", color: theme.success },
    thinking: { icon: "◐", text: "Thinking", color: theme.warning },
    streaming: { icon: "◑", text: "Streaming", color: theme.accent },
    tool_use: { icon: "⚡", text: "Tools", color: theme.info },
    error: { icon: indicators.error, text: "Error", color: theme.error },
  }[sessionStatus];

  return (
    <Box justifyContent="center" paddingY={0}>
      <Box>
        <Text color={statusConfig.color}>{statusConfig.icon} </Text>
        <Text color={theme.textMuted}>{statusConfig.text}</Text>
      </Box>
    </Box>
  );
});
