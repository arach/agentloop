import React, { memo } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

const HELP_ITEMS = [
  { key: "Enter", action: "Send" },
  { key: "^N", action: "New" },
  { key: "^R", action: "Reconnect" },
  { key: "^C", action: "Quit" },
] as const;

export const HelpBar = memo(function HelpBar() {
  return (
    <Box justifyContent="center" paddingTop={1}>
      <Box gap={2}>
        {HELP_ITEMS.map((item) => (
          <Box key={item.key}>
            <Text backgroundColor={theme.bgHighlight} color={theme.text}>
              {" "}{item.key}{" "}
            </Text>
            <Text color={theme.textMuted}> {item.action}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
});
