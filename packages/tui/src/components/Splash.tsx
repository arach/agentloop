import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";

const LOGO_LINES = [
  "     █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  "    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  "    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
  "",
  "    ██╗      ██████╗  ██████╗ ██████╗           ",
  "    ██║     ██╔═══██╗██╔═══██╗██╔══██╗          ",
  "    ██║     ██║   ██║██║   ██║██████╔╝          ",
  "    ██║     ██║   ██║██║   ██║██╔═══╝           ",
  "    ███████╗╚██████╔╝╚██████╔╝██║               ",
  "    ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝               ",
];

const TAGLINE = "Your AI-powered development companion";

interface SplashProps {
  onComplete: () => void;
}

export function Splash({ onComplete }: SplashProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(timer);
          setTimeout(onComplete, 200);
          return 100;
        }
        return p + 5;
      });
    }, 40);

    return () => clearInterval(timer);
  }, [onComplete]);

  const progressBarWidth = 30;
  const filledWidth = Math.floor((progress / 100) * progressBarWidth);

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height="100%"
    >
      {/* Logo */}
      <Box flexDirection="column" alignItems="center">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={i < 6 ? theme.primary : theme.accent}>
            {line}
          </Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box marginTop={1}>
        <Text color={theme.textMuted}>{TAGLINE}</Text>
      </Box>

      {/* Progress bar */}
      <Box flexDirection="column" alignItems="center" marginTop={2}>
        <Box>
          <Text color={theme.border}>[</Text>
          <Text color={theme.primary}>{"█".repeat(filledWidth)}</Text>
          <Text color={theme.bgHighlight}>{"░".repeat(progressBarWidth - filledWidth)}</Text>
          <Text color={theme.border}>]</Text>
          <Text color={theme.textDim}> {progress}%</Text>
        </Box>
      </Box>

      {/* Version */}
      <Box marginTop={2}>
        <Text color={theme.textDim}>v0.1.0</Text>
      </Box>
    </Box>
  );
}
