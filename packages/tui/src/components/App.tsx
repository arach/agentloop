import React, { useState, useCallback, useMemo } from "react";
import { Box, useApp, useInput } from "ink";
import { Splash } from "./Splash.js";
import { Header } from "./Header.js";
import { MessageList } from "./MessageList.js";
import { Prompt } from "./Prompt.js";
import { HelpBar } from "./HelpBar.js";
import { useEngine } from "../hooks/useEngine.js";

type Screen = "splash" | "main";

export function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("splash");

  const engine = useEngine({ autoConnect: false });

  const handleSplashComplete = useCallback(() => {
    setScreen("main");
    engine.connect();
  }, [engine]);

  const handleSubmit = useCallback(
    (value: string) => {
      engine.sendMessage(value);
    },
    [engine]
  );

  // Global key handlers
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      engine.disconnect();
      exit();
      return;
    }

    if (screen !== "main") return;

    if (key.ctrl && input === "n") {
      engine.newSession();
      return;
    }

    if (key.ctrl && input === "r") {
      engine.disconnect();
      setTimeout(() => engine.connect(), 100);
      return;
    }
  });

  const isProcessing =
    engine.sessionStatus === "thinking" || engine.sessionStatus === "streaming";

  const placeholder = useMemo(() => {
    if (engine.status !== "connected") return "Connecting to engine...";
    if (isProcessing) return "Agent is responding...";
    return "Type your message here...";
  }, [engine.status, isProcessing]);

  if (screen === "splash") {
    return <Splash onComplete={handleSplashComplete} />;
  }

  return (
    <Box flexDirection="column">
      <Header
        connectionStatus={engine.status}
        sessionStatus={engine.sessionStatus}
        sessionId={engine.sessionId}
      />

      <Box flexDirection="column" paddingX={1}>
        <MessageList
          messages={engine.messages}
          streamingContent={engine.streamingContent}
          isStreaming={engine.sessionStatus === "streaming"}
        />
      </Box>

      <Box flexDirection="column" paddingX={1}>
        <Prompt
          onSubmit={handleSubmit}
          disabled={engine.status !== "connected" || isProcessing}
          placeholder={placeholder}
        />
        <HelpBar />
      </Box>
    </Box>
  );
}
