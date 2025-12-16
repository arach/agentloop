import React, { useState, useMemo, memo } from "react";
import { Box, Text, useInput } from "ink";
import { theme, box } from "../theme.js";

interface PromptProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const Prompt = memo(function Prompt({
  onSubmit,
  disabled = false,
  placeholder = "Type your message here...",
}: PromptProps) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (disabled) return;

    if (key.return && value.trim()) {
      onSubmit(value.trim());
      setValue("");
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    // Handle regular character input
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  const borderColor = disabled ? theme.textDim : theme.primary;

  const displayContent = useMemo(() => {
    if (disabled) {
      return <Text color={theme.textDim}>{placeholder}</Text>;
    }
    if (!value) {
      return (
        <>
          <Text color={theme.accent}>▌</Text>
          <Text color={theme.textDim}>{placeholder}</Text>
        </>
      );
    }
    return (
      <>
        <Text color={theme.text}>{value}</Text>
        <Text color={theme.accent}>▌</Text>
      </>
    );
  }, [value, disabled, placeholder]);

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Box>
        <Text color={borderColor}>
          {box.topLeft}{box.horizontal}
        </Text>
        <Text color={theme.accent}>Message</Text>
        <Text color={borderColor}>
          {" "}{box.horizontal.repeat(66)}{box.topRight}
        </Text>
      </Box>

      {/* Input area */}
      <Box>
        <Text color={borderColor}>{box.vertical} </Text>
        <Box width={74}>
          {displayContent}
        </Box>
        <Text color={borderColor}> {box.vertical}</Text>
      </Box>

      {/* Bottom border */}
      <Box>
        <Text color={borderColor}>
          {box.bottomLeft}{box.horizontal.repeat(76)}{box.bottomRight}
        </Text>
      </Box>
    </Box>
  );
});
