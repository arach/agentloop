import {
  ASCIIFontRenderable,
  BoxRenderable,
  ScrollBoxRenderable,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
} from "@opentui/core";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  createId,
  type Command,
  type EngineEvent,
  type Message,
  type ServiceName,
  type ServiceState,
} from "@agentloop/core";
import { EngineWsClient } from "./engineWsClient.js";
import { tryCopyToClipboard } from "./utils/clipboard.js";
import {
  ensureRunDir,
  isLocalHost,
  isPidAlive,
  readEngineStateFile,
  resolveEnginePaths,
  spawnManagedEngine,
  stopManagedEngine,
  waitForEngineStateFile,
} from "./utils/engineManager.js";
import { runGit } from "./utils/git.js";
import { formatCmd, installers, runInstaller, type InstallerId } from "./utils/installers.js";
import { kokomoTtsLocalToWavFile, kokomoTtsToWavFile, tryPlayAudioFile } from "./utils/kokomo.js";
import { fetchLogoToCache } from "./utils/logos.js";
import { createLogger } from "./utils/logger.js";
import { theme } from "./ui/theme.js";
import { clampLines, extractCodeBlocks, formatTime, maybeExtractPath } from "./ui/text.js";
import { renderConversation, type ConversationStatus } from "./ui/conversation.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
const versionTag = process.env.AGENTLOOP_VERSION ?? "dev";

type Screen = "splash" | "main";

export async function runTui(options: { engineHost?: string; enginePort?: number }): Promise<void> {
  let engineHost = options.engineHost ?? DEFAULT_CONFIG.engineHost;
  let enginePort = options.enginePort ?? DEFAULT_CONFIG.enginePort;
  const enginePaths = resolveEnginePaths();
  void ensureRunDir(enginePaths.runDir).catch(() => {});
  const log = createLogger({ repoRoot: enginePaths.repoRoot, alsoConsole: true });

  let screen: Screen = "splash";
  let aboutOpen = false;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
    enableMouseMovement: true,
    useAlternateScreen: true,
    backgroundColor: theme.bg,
    useKittyKeyboard: { events: true },
  });

  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.bg,
    padding: 0,
    gap: 0,
    onMouseDragEnd: () => {
      if (process.env.AGENTLOOP_AUTOCOPY_SELECTION !== "1") return;
      void (async () => {
        if (!renderer.hasSelection) return;
        const selected = getSelectionText().trimEnd();
        if (!selected.trim()) return;
        const now = Date.now();
        if (now - lastAutoCopyAt < 250) return;
        if (selected === lastAutoCopied) return;

        const ok = await tryCopyToClipboard(selected);
        if (ok) {
          lastAutoCopied = selected;
          lastAutoCopyAt = now;
          addSystemMessage(`[copy] selection copied (${selected.length} chars)`);
          requestRender();
        } else {
          addSystemMessage("[copy] failed (clipboard tool not found)");
        }
      })();
    },
  });
  renderer.root.add(root);

  // Splash (overlay)
  const splashOverlay = new BoxRenderable(renderer, {
    id: "splashOverlay",
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: theme.bg,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50,
    padding: 2,
  });
  root.add(splashOverlay);

  const splashCard = new BoxRenderable(renderer, {
    id: "splashCard",
    width: "90%",
    maxWidth: 120,
    border: true,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    padding: 2,
    flexDirection: "column",
    gap: 1,
  });
  splashOverlay.add(splashCard);

  const splashTitle = new ASCIIFontRenderable(renderer, {
    id: "splashTitle",
    text: "AgentLoop",
    font: "tiny",
    selectable: false,
    backgroundColor: theme.panelBg,
    color: [theme.fg, theme.muted, theme.dim, theme.muted, theme.fg],
  });
  splashCard.add(splashTitle);

  const splashBody = new TextRenderable(renderer, {
    id: "splashBody",
    fg: theme.fg,
    selectable: true,
    wrapMode: "word",
    content: [
      "A prototype agent manager + TUI.",
      "",
      "Highlights:",
      "- Chat with your running engine",
      "- Managed services (Kokomo TTS, MLX LLM)",
      "- /install inside the UI for discoverability",
      "",
      "Press Enter to continue.",
      "Ctrl+A: About  •  Ctrl+C: Quit",
    ].join("\n"),
  });
  splashCard.add(splashBody);

  // About (overlay modal)
  const aboutOverlay = new BoxRenderable(renderer, {
    id: "aboutOverlay",
    position: "absolute",
    top: "8%",
    left: "8%",
    width: "84%",
    height: "84%",
    zIndex: 100,
    border: true,
    borderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    padding: 2,
    flexDirection: "column",
    gap: 1,
    visible: false,
  });
  root.add(aboutOverlay);

  const aboutTop = new BoxRenderable(renderer, {
    id: "aboutTop",
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 2,
  });
  aboutOverlay.add(aboutTop);

  const aboutTitle = new ASCIIFontRenderable(renderer, {
    id: "aboutTitle",
    text: "AgentLoop",
    font: "tiny",
    selectable: true,
    backgroundColor: theme.panelBg,
    color: [theme.fg, theme.muted, theme.dim, theme.muted, theme.fg],
  });
  aboutTop.add(aboutTitle);

  const aboutMeta = new TextRenderable(renderer, {
    id: "aboutMeta",
    fg: theme.muted,
    wrapMode: "none",
    selectable: true,
    content: [
      "Local-first agent manager",
      "TUI + Engine + Services",
      "",
      "Made with heart by @arach",
    ].join("\n"),
  });
  aboutTop.add(aboutMeta);

  const aboutDivider = new TextRenderable(renderer, {
    id: "aboutDivider",
    fg: theme.dim2,
    wrapMode: "none",
    selectable: false,
    content: "────────────────────────────────────────────────────────────────────────────",
    height: 1,
  });
  aboutOverlay.add(aboutDivider);

  const aboutBody = new BoxRenderable(renderer, {
    id: "aboutBody",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 2,
  });
  aboutOverlay.add(aboutBody);

  const aboutScroll = new ScrollBoxRenderable(renderer, {
    id: "aboutScroll",
    flexGrow: 1,
    scrollY: true,
    stickyScroll: false,
    viewportCulling: true,
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panelBg } },
  });
  aboutBody.add(aboutScroll);

  const aboutText = new TextRenderable(renderer, {
    id: "aboutText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "word",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    content: [
      "What is this?",
      "  AgentLoop is a prototype agent/service manager with a local-first workflow.",
      "  It’s optimized for iterating on agents and local tooling on a Mac.",
      "",
      "What’s inside",
      "  - Engine: WebSocket session server",
      "  - TUI: OpenTUI-based terminal UI",
      "  - Services: managed local processes (TTS/LLM/VLM)",
      "",
      "Services (quick start)",
      "  - TTS (kokomo): /install kokomo --yes  →  /service kokomo start  →  /say hello",
      "  - LLM (mlx):    /install mlx --yes     →  /service mlx start     →  chat normally",
      "  - VLM (vlm):    /install vlm --yes     →  /service vlm start     →  (image chat WIP in TUI)",
      "",
      "Repo",
      "  https://github.com/arach/agentloop",
      "",
      "Notes",
      "  - /install is explicit (you must pass --yes).",
      "  - Services stream logs into the sidebar.",
    ].join("\n"),
  });
  aboutScroll.add(aboutText);

  const shortcutsPanel = new BoxRenderable(renderer, {
    id: "shortcutsPanel",
    width: 34,
    minWidth: 28,
    border: true,
    borderColor: theme.border,
    backgroundColor: theme.panelBg2,
    padding: 1,
    flexDirection: "column",
    gap: 1,
  });
  aboutBody.add(shortcutsPanel);

  const shortcutsTitle = new TextRenderable(renderer, {
    id: "shortcutsTitle",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    content: "Shortcuts",
    height: 1,
  });
  shortcutsPanel.add(shortcutsTitle);

  const shortcutsText = new TextRenderable(renderer, {
    id: "shortcutsText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "none",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    content: [
      "Enter       send",
      "Shift+Enter newline",
      "Tab         cycle focus",
      "↑/↓         history (edge)",
      "",
      "^Y          copy last",
      "^N          new session",
      "^R          reconnect",
      "^A          about",
      "^C          quit (press twice)",
    ].join("\n"),
  });
  shortcutsPanel.add(shortcutsText);

  const aboutFooter = new TextRenderable(renderer, {
    id: "aboutFooter",
    fg: theme.dim,
    wrapMode: "none",
    selectable: false,
    content: "Esc or Ctrl+A to close • Tip: click to focus panels, drag to select text",
    height: 1,
  });
  aboutOverlay.add(aboutFooter);

  // Header
  const header = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    // Border consumes 2 rows; keep this at 3 so we always have 1 content row.
    height: 3,
    border: true,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    paddingLeft: 2,
    paddingRight: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  });
  const headerLeft = new TextRenderable(renderer, {
    id: "headerLeft",
    fg: theme.fg,
    wrapMode: "none",
    selectable: false,
    flexGrow: 1,
    height: 1,
  });
  const headerRight = new TextRenderable(renderer, {
    id: "headerRight",
    fg: theme.fg,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  header.add(headerLeft);
  header.add(headerRight);
  root.add(header);

  // Main row (conversation + sidebar)
  const mainRow = new BoxRenderable(renderer, {
    id: "mainRow",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 0,
  });
  root.add(mainRow);

  const conversationPanel = new BoxRenderable(renderer, {
    id: "conversationPanel",
    flexGrow: 1,
    border: true,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    padding: 1,
    flexDirection: "column",
    title: "Conversation",
    titleAlignment: "left",
    onMouseDown: () => renderer.focusRenderable(conversationScroll),
  });
  mainRow.add(conversationPanel);

  const conversationScroll = new ScrollBoxRenderable(renderer, {
    id: "conversationScroll",
    flexGrow: 1,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
    contentOptions: { flexDirection: "column" },
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panelBg } },
  });
  conversationPanel.add(conversationScroll);

  const conversationText = new TextRenderable(renderer, {
    id: "conversationText",
    fg: theme.fg,
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    selectable: true,
    wrapMode: "word",
    width: "100%",
  });
  conversationScroll.add(conversationText);

  const sidebar = new BoxRenderable(renderer, {
    id: "sidebar",
    width: 44,
    minWidth: 36,
    maxWidth: 56,
    border: true,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    padding: 1,
    flexDirection: "column",
    gap: 1,
    onMouseDown: () => renderer.focusRenderable(sidebarScroll),
  });
  mainRow.add(sidebar);

  // Sidebar: Services (always visible) + scrollable sections
  const servicesSection = new BoxRenderable(renderer, {
    id: "servicesSection",
    flexDirection: "column",
    gap: 1,
    width: "100%",
  });
  sidebar.add(servicesSection);

  const servicesTitle = new TextRenderable(renderer, {
    id: "servicesTitle",
    content: "Services",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  servicesSection.add(servicesTitle);

  let activeService: ServiceName = "kokomo";
  const serviceTabs = new TabSelectRenderable(renderer, {
    id: "serviceTabs",
    height: 3,
    tabWidth: 10,
    showDescription: false,
    showUnderline: true,
    wrapSelection: true,
    backgroundColor: theme.panelBg,
    textColor: theme.dim2,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectedBackgroundColor: theme.panelBg2,
    selectedTextColor: theme.fg,
    options: [
      { name: "kokomo", description: "Kokomo TTS", value: "kokomo" },
      { name: "mlx", description: "MLX LLM", value: "mlx" },
      { name: "vlm", description: "MLX VLM", value: "vlm" },
    ],
  });
  servicesSection.add(serviceTabs);

  const servicesMeta = new TextRenderable(renderer, {
    id: "servicesMeta",
    fg: theme.dim,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  servicesSection.add(servicesMeta);

  const servicesText = new TextRenderable(renderer, {
    id: "servicesText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "none",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    height: 9,
  });
  servicesSection.add(servicesText);

  const serviceActions = new TabSelectRenderable(renderer, {
    id: "serviceActions",
    height: 1,
    tabWidth: 8,
    showDescription: false,
    showUnderline: false,
    wrapSelection: true,
    backgroundColor: theme.panelBg,
    textColor: theme.dim2,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectedBackgroundColor: theme.panelBg,
    selectedTextColor: theme.fg,
    options: [
      { name: "start", description: "Start service", value: "start" },
      { name: "stop", description: "Stop service", value: "stop" },
      { name: "status", description: "Status", value: "status" },
    ],
  });
  servicesSection.add(serviceActions);

  const sidebarScroll = new ScrollBoxRenderable(renderer, {
    id: "sidebarScroll",
    flexGrow: 1,
    scrollY: true,
    stickyScroll: false,
    viewportCulling: true,
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.borderFocused, backgroundColor: theme.panelBg } },
    contentOptions: { flexDirection: "column" },
  });
  sidebar.add(sidebarScroll);

  // Logs section (tabbed per service)
  const logsSection = new BoxRenderable(renderer, {
    id: "logsSection",
    width: "100%",
    flexDirection: "column",
    gap: 1,
  });
  sidebarScroll.add(logsSection);

  const logsHeaderRow = new BoxRenderable(renderer, {
    id: "logsHeaderRow",
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  });
  logsSection.add(logsHeaderRow);

  let logsCollapsed = false;
  const logsTitle = new TextRenderable(renderer, {
    id: "logsTitle",
    content: "Logs (click to toggle)",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
    onMouseDown: () => {
      logsCollapsed = !logsCollapsed;
      logsServiceTabs.visible = !logsCollapsed;
      logsScroll.visible = !logsCollapsed;
      requestRender();
    },
  });
  logsHeaderRow.add(logsTitle);

  const logsServiceTabs = new TabSelectRenderable(renderer, {
    id: "logsServiceTabs",
    height: 3,
    tabWidth: 10,
    showDescription: false,
    showUnderline: true,
    wrapSelection: true,
    backgroundColor: theme.panelBg,
    textColor: theme.dim2,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectedBackgroundColor: theme.panelBg2,
    selectedTextColor: theme.fg,
    options: [{ name: "kokomo", description: "kokomo logs", value: "kokomo" }],
  });
  logsSection.add(logsServiceTabs);

  const logsScroll = new ScrollBoxRenderable(renderer, {
    id: "logsScroll",
    height: 12,
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panelBg } },
  });
  logsSection.add(logsScroll);

  const logsText = new TextRenderable(renderer, {
    id: "logsText",
    fg: theme.dim,
    selectable: true,
    wrapMode: "word",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    width: "100%",
  });
  logsScroll.add(logsText);

  // Actions / Copy section
  const inspectorSection = new BoxRenderable(renderer, {
    id: "inspectorSection",
    width: "100%",
    flexDirection: "column",
    gap: 1,
  });
  sidebarScroll.add(inspectorSection);

  const inspectorTitle = new TextRenderable(renderer, {
    id: "inspectorTitle",
    content: "Inspector",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  inspectorSection.add(inspectorTitle);

  const inspectorScroll = new ScrollBoxRenderable(renderer, {
    id: "inspectorScroll",
    height: 10,
    scrollY: true,
    stickyScroll: false,
    viewportCulling: true,
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panelBg } },
  });
  inspectorSection.add(inspectorScroll);

  const inspectorText = new TextRenderable(renderer, {
    id: "inspectorText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "word",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    width: "100%",
  });
  inspectorScroll.add(inspectorText);

  // Actions / Copy section
  const actionsSection = new BoxRenderable(renderer, {
    id: "actionsSection",
    width: "100%",
    flexDirection: "column",
    gap: 1,
  });
  sidebarScroll.add(actionsSection);

  const actionsTitle = new TextRenderable(renderer, {
    id: "actionsTitle",
    content: "Quick Actions",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  actionsSection.add(actionsTitle);

  const actionTabs = new TabSelectRenderable(renderer, {
    id: "actionTabs",
    height: 3,
    tabWidth: 12,
    showDescription: false,
    showUnderline: true,
    wrapSelection: true,
    backgroundColor: theme.panelBg,
    textColor: theme.dim2,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectedBackgroundColor: theme.panelBg2,
    selectedTextColor: theme.fg,
    options: [
      { name: "copy last", description: "Copy last assistant", value: "copy_last" },
      { name: "copy sel", description: "Copy selection", value: "copy_sel" },
      { name: "copy code", description: "Copy last code block", value: "copy_code" },
      { name: "copy wav", description: "Copy last audio path", value: "copy_wav" },
    ],
  });
  actionsSection.add(actionTabs);

  // Presets section
  const presetsSection = new BoxRenderable(renderer, {
    id: "presetsSection",
    width: "100%",
    flexDirection: "column",
    gap: 1,
  });
  sidebarScroll.add(presetsSection);

  let presetsCollapsed = false;
  const presetsTitle = new TextRenderable(renderer, {
    id: "presetsTitle",
    content: "Presets (click to toggle)",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
    onMouseDown: () => {
      presetsCollapsed = !presetsCollapsed;
      presetsTabs.visible = !presetsCollapsed;
      requestRender();
    },
  });
  presetsSection.add(presetsTitle);

  const presetsTabs = new TabSelectRenderable(renderer, {
    id: "presetsTabs",
    height: 3,
    tabWidth: 16,
    showDescription: false,
    showUnderline: true,
    wrapSelection: true,
    backgroundColor: theme.panelBg,
    textColor: theme.dim2,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectedBackgroundColor: theme.panelBg2,
    selectedTextColor: theme.fg,
    options: [
      { name: "/help", description: "Show help", value: "/help" },
      { name: "install kokomo", description: "Install TTS", value: "/install kokomo --yes" },
      { name: "install mlx", description: "Install LLM", value: "/install mlx --yes" },
      { name: "install vlm", description: "Install VLM", value: "/install vlm --yes" },
      { name: "start kokomo", description: "Start service", value: "/service kokomo start" },
      { name: "start mlx", description: "Start LLM", value: "/service mlx start" },
      { name: "start vlm", description: "Start VLM", value: "/service vlm start" },
      { name: "say hello", description: "Speak", value: "/say hello there" },
    ],
  });
  presetsSection.add(presetsTabs);

  // Commands section (collapsed by default)
  let commandsCollapsed = true;
  const commandsSection = new BoxRenderable(renderer, {
    id: "commandsSection",
    width: "100%",
    flexDirection: "column",
    gap: 1,
  });
  sidebarScroll.add(commandsSection);

  const commandsTitle = new TextRenderable(renderer, {
    id: "commandsTitle",
    content: "Commands (click to toggle)",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
    onMouseDown: () => {
      commandsCollapsed = !commandsCollapsed;
      commandsText.visible = !commandsCollapsed;
      requestRender();
    },
  });
  commandsSection.add(commandsTitle);

  const commandsText = new TextRenderable(renderer, {
    id: "commandsText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "word",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    visible: !commandsCollapsed,
    content: ["/say <text>", "/service kokomo|mlx|vlm start|stop|status", "/install list", "/help"].join("\n"),
  });
  commandsSection.add(commandsText);

  // Footer (input + help)
  const footer = new BoxRenderable(renderer, {
    id: "footer",
    width: "100%",
    height: 6,
    flexDirection: "column",
    gap: 0,
    onMouseDown: () => {
      renderer.focusRenderable(textarea);
      textarea.focus();
      renderer.requestRender();
    },
  });
  root.add(footer);

  const inputBox = new BoxRenderable(renderer, {
    id: "inputBox",
    flexGrow: 1,
    border: true,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    padding: 1,
    flexDirection: "column",
    onMouseDown: () => {
      renderer.focusRenderable(textarea);
      textarea.focus();
      renderer.requestRender();
    },
  });
  footer.add(inputBox);

  const composerHeader = new TextRenderable(renderer, {
    id: "composerHeader",
    height: 1,
    selectable: false,
    wrapMode: "none",
    fg: theme.muted,
    content: "You",
    onMouseDown: () => {
      renderer.focusRenderable(textarea);
      textarea.focus();
      renderer.requestRender();
    },
  });
  inputBox.add(composerHeader);

  const textarea = new TextareaRenderable(renderer, {
    id: "input",
    flexGrow: 1,
    wrapMode: "word",
    backgroundColor: theme.panelBg,
    textColor: theme.fg,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    placeholder: "Message (/help for commands)…",
    onMouseDown: () => {
      renderer.focusRenderable(textarea);
      textarea.focus();
      renderer.requestRender();
    },
    keyBindings: [
      { name: "return", action: "submit" },
      { name: "linefeed", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "linefeed", shift: true, action: "newline" },
    ],
  });
  inputBox.add(textarea);

  const helpBar = new TextRenderable(renderer, {
    id: "helpBar",
    height: 1,
    fg: theme.dim,
    wrapMode: "none",
    selectable: false,
  });
  footer.add(helpBar);

  // Screen visibility defaults
  splashOverlay.visible = true;
  header.visible = false;
  mainRow.visible = false;
  footer.visible = false;

  // State
  let connectionStatus: ConnectionStatus = "disconnected";
  let sessionId: string = createId();
  let sessionStatus: ConversationStatus = "idle";
  let error: string | null = null;
  let streamingContent = "";
  let messages: Message[] = [];
  let services: Record<string, ServiceState> = {};
  let serviceLogs: Record<string, string[]> = {};
  let lastServiceStatusLineByName: Record<string, string> = {};
  let pendingPerf:
    | {
        startedAt: number;
        contentLength: number;
        firstTokenAt?: number;
        tokens: number;
      }
    | null = null;

  // Command history
  const history: string[] = [];
  let historyIndex: number | null = null;

  // Sidebar state
  let activeLogService: string = "kokomo";
  let lastLogTabsKey = "";
  let servicesTabsSynced = false;
  let serviceSelectionAnnounceEnabled = false;
  const recentServiceFeed: string[] = [];
  let lastInstallCheckAt = 0;
  let installState: Record<ServiceName, boolean> = { kokomo: false, mlx: false, vlm: false };
  let autoStartedMlx = false;
  let routingMode: "auto" | "pinned" = "auto";
  let activeAgentName: string | null = null;
  let lastRouterReason: string | null = null;
  let lastRouterMs: number | null = null;
  let pendingAgentList = false;
  let lastAgentList: { name: string; description?: string; tools: string[] }[] = [];
  let sessionPromptOverride: string | null = null;
  let toast: string | null = null;
  let toastUntil = 0;

  // Auto-copy selection state
  let lastAutoCopyAt = 0;
  let lastAutoCopied = "";
  let welcomeShown = false;
  let quitArmedAt = 0;

  const engine = new EngineWsClient({ host: engineHost, port: enginePort });
  let managedEngineProc: ReturnType<typeof spawnManagedEngine> | null = null;

  const setEngineTarget = (host: string, port: number) => {
    engineHost = host;
    enginePort = port;
    engine.setTarget({ host, port });
  };

  log.info(`AgentLoop starting (version ${versionTag}) target ws://${engineHost}:${enginePort}`);

  const requestRender = () => renderer.requestRender();

  const setToast = (message: string, ms = 2500) => {
    toast = message;
    toastUntil = Date.now() + ms;
    requestRender();
  };

  const addMessage = (m: Message) => {
    messages = [...messages, m];
    requestRender();
  };

  const addSystemMessage = (content: string, opts?: { silent?: boolean }) => {
    if (opts?.silent) return;
    addMessage({ id: createId(), role: "system", content, timestamp: Date.now() });
  };

  const getSelectionText = () => renderer.getSelectionContainer()?.getSelectedText?.() ?? "";

  const updateHeader = () => {
    const conn =
      connectionStatus === "connected"
        ? "connected"
        : connectionStatus === "connecting"
          ? "connecting"
          : connectionStatus === "error"
            ? "error"
            : "disconnected";
    const sStatus = `session ${sessionStatus}`;
    const err = error ? ` · ${error}` : "";
    const agentLabel = routingMode === "pinned" ? `agent ${activeAgentName ?? "(unset)"}` : "agent auto";
    headerLeft.content = `AgentLoop ${versionTag}`;
    headerRight.content = `${conn}${err} · ${sStatus} · ${agentLabel} · ws://${engineHost}:${enginePort}`;
  };

  const updateConversation = () => {
    conversationText.content = renderConversation({
      theme,
      messages,
      sessionStatus,
      streamingContent,
    });
  };

  const updateInspector = () => {
    const selected = getSelectionText();
    const lastAudio = getLastAudioPath();

    if (selected.trim()) {
      const trimmed = selected.trimEnd();
      const preview = trimmed.slice(0, 600) + (trimmed.length > 600 ? "…" : "");
      inspectorText.content = [
        `Selection (${trimmed.length} chars):`,
        "",
        preview,
        "",
        lastAudio ? `Last audio: ${lastAudio}` : "Last audio: —",
        "",
        "Tip: Cmd/Ctrl+C (or Quick Actions → copy sel)",
      ].join("\n");
      return;
    }

    const lastAssistant = getLastAssistantMessage();
    const codeBlocks = lastAssistant ? extractCodeBlocks(lastAssistant) : [];
    const preview =
      lastAssistant.trim().length > 0
        ? lastAssistant.trim().slice(0, 600) + (lastAssistant.trim().length > 600 ? "…" : "")
        : "(no assistant messages yet)";

    inspectorText.content = [
      `Last assistant (${codeBlocks.length} code block${codeBlocks.length === 1 ? "" : "s"}):`,
      "",
      preview,
      "",
      lastAudio ? `Last audio: ${lastAudio}` : "Last audio: —",
      "",
      "Use Quick Actions to copy last/selection/code/wav.",
    ].join("\n");
  };

  const updateSidebar = () => {
    const now = Date.now();
    if (now - lastInstallCheckAt > 2000) {
      lastInstallCheckAt = now;
      void (async () => {
        const root = enginePaths.repoRoot;
        const checks: Record<ServiceName, string> = {
          kokomo: "external/kokomo-mlx/.venv/bin/python",
          mlx: "external/mlx-llm/.venv/bin/python",
          vlm: "external/mlx-vlm/.venv/bin/python",
        };
        const next: Record<ServiceName, boolean> = { ...installState };
        for (const name of Object.keys(checks) as ServiceName[]) {
          try {
            next[name] = await Bun.file(path.join(root, checks[name])).exists();
          } catch {
            next[name] = false;
          }
        }
        installState = next;
        requestRender();
      })();
    }

    const portByService: Record<ServiceName, number> = { kokomo: 8880, mlx: 12345, vlm: 12346 };
    servicesMeta.content = `active=${activeService} · actions: start/stop/status · ports: k${portByService.kokomo} m${portByService.mlx} v${portByService.vlm}`;
    const known: ServiceName[] = ["kokomo", "mlx", "vlm"];

    const svcLines: string[] = [];
    svcLines.push("name     inst  state        port   detail");
    for (const name of known) {
      const svc = services[name];
      const status = (svc?.status ?? "unknown").padEnd(10, " ");
      const inst = installState[name] ? "yes " : "no  ";
      const port = String(portByService[name]).padEnd(5, " ");
      const detail = (svc?.detail ?? "").trim();
      const tail = svc?.lastError ? `err: ${svc.lastError}` : svc?.lastExitCode != null ? `exit: ${svc.lastExitCode}` : "";
      svcLines.push(`${name.padEnd(7, " ")} ${inst} ${status} ${port}  ${(detail || tail || "—").slice(0, 60)}`);
    }

    const feed = recentServiceFeed.slice(-3);
    const feedBlock = feed.length ? `\n\nRecent:\n${feed.join("\n")}` : "";
    servicesText.content = svcLines.join("\n") + feedBlock;

    if (!servicesTabsSynced) {
      // Ensure service tab selection starts on kokomo.
      serviceTabs.setSelectedIndex(activeService === "mlx" ? 1 : 0);
      servicesTabsSynced = true;
      serviceSelectionAnnounceEnabled = true;
    }

    // Per-service log tabs
    const serviceNames = Array.from(
      new Set<string>([
        ...Object.keys(services),
        ...Object.keys(serviceLogs),
        "kokomo",
      ].filter(Boolean))
    ).sort();

    const tabOptions = serviceNames.map((name) => ({ name, description: `${name} logs`, value: name }));
    const tabKey = tabOptions.map((o) => o.name).join("|");
    if (tabKey !== lastLogTabsKey) {
      logsServiceTabs.setOptions(tabOptions);
      lastLogTabsKey = tabKey;
    }

    const idx = tabOptions.findIndex((o) => o.value === activeLogService);
    if (idx >= 0 && logsServiceTabs.getSelectedIndex() !== idx) {
      logsServiceTabs.setSelectedIndex(idx);
    }

    logsTitle.content = `Logs (click to toggle) • ${activeLogService}`;
    const logs = clampLines(serviceLogs[activeLogService] ?? [], 160);
    logsText.content = logs.join("\n");
  };

  const updateHelp = () => {
    const base =
      "Enter send · Shift+Enter newline · Tab focus · ↑/↓ history · Ctrl/Cmd+C copy selection · ^Y copy last · ^A about · ^N new · ^R reconnect/start backend · ^C quit";
    if (toast && Date.now() < toastUntil) {
      helpBar.content = `${toast}  —  ${base}`;
      return;
    }
    toast = null;
    helpBar.content = base;
  };

  const updateAll = () => {
    updateHeader();
    updateConversation();
    updateInspector();
    updateSidebar();
    updateHelp();
    composerHeader.content =
      sessionStatus === "thinking" || sessionStatus === "streaming" || sessionStatus === "tool_use"
        ? "You (waiting…) "
        : "You";
  };

  updateAll();

  const applyScreenVisibility = () => {
    const isSplash = screen === "splash";
    splashOverlay.visible = isSplash;
    header.visible = !isSplash;
    mainRow.visible = !isSplash;
    footer.visible = !isSplash;
    aboutOverlay.visible = aboutOpen && !isSplash;
  };

  const setScreen = (next: Screen) => {
    screen = next;
    applyScreenVisibility();
    if (screen === "main") {
      renderer.focusRenderable(textarea);
      textarea.focus();
      void connectToEngine();
    }
    requestRender();
  };

  const setAboutOpen = (next: boolean) => {
    aboutOpen = next;
    applyScreenVisibility();
    if (aboutOpen) {
      renderer.focusRenderable(aboutScroll);
      aboutScroll.focus();
    } else if (screen === "main") {
      renderer.focusRenderable(textarea);
      textarea.focus();
    }
    requestRender();
  };

  applyScreenVisibility();

  // Splash shimmer
  let shimmerTick = 0;
  const shimmerTimer = setInterval(() => {
    if (screen !== "splash") return;
    shimmerTick = (shimmerTick + 1) % 12;
    const colors = Array.from({ length: 12 }, (_, i) => {
      const d = Math.abs(((i + shimmerTick) % 12) - 6);
      if (d <= 1) return theme.fg;
      if (d <= 3) return theme.muted;
      return theme.dim;
    });
    splashTitle.color = colors;
    requestRender();
  }, 120);

  // Inspector refresh (selection doesn't emit events yet)
  const inspectorTimer = setInterval(() => {
    if (screen !== "main" || aboutOpen) return;
    updateInspector();
    requestRender();
  }, 250);

  const destroy = () => {
    clearInterval(shimmerTimer);
    clearInterval(inspectorTimer);
    try {
      engine.disconnect();
    } catch {
      // ignore
    }
    renderer.destroy();
  };

  let connectPromise: Promise<void> | null = null;
  const connectToEngine = async (opts?: { forceManaged?: boolean }) => {
    if (connectPromise) return connectPromise;
    connectPromise = (async () => {
      const preferredHost = engineHost;
      const preferredPort = enginePort;

      const tryConnect = async (host: string, port: number, label: string) => {
        setEngineTarget(host, port);
        addSystemMessage(`Connecting to ${label} at ${engine.url}… (press ^R to retry)`, { silent: true });
        log.info(`connect attempt: ${label} -> ${engine.url}`);
    connectionStatus = "connecting";
    error = null;
    updateAll();
    await engine.connect();
    connectionStatus = "connected";
    error = null;
    updateAll();
    log.info(`connected: ${engine.url}`);
        send({ type: "session.create", payload: { sessionId } });
	        if (!welcomeShown) {
	          welcomeShown = true;
	          addSystemMessage(["Welcome to AgentLoop.", "Type a message to chat, or run /help to see commands.", "Quick start: /install list"].join("\n"));
	        }
	        engine.send({ type: "service.status", payload: { name: "kokomo" } } as Command);
	        engine.send({ type: "service.status", payload: { name: "mlx" } } as Command);
	        engine.send({ type: "service.status", payload: { name: "vlm" } } as Command);
	
	        // Autostart MLX if installed. Disable with AGENTLOOP_AUTOSTART_MLX=0.
	        const autostart = process.env.AGENTLOOP_AUTOSTART_MLX !== "0";
	        if (!autoStartedMlx && autostart) {
	          autoStartedMlx = true;
	          void (async () => {
	            try {
	              const mlxVenvPy = path.join(enginePaths.repoRoot, "external/mlx-llm/.venv/bin/python");
	              const installed = await Bun.file(mlxVenvPy).exists();
	              if (!installed) return;
	              log.info("[mlx] autostart");
	              send({ type: "service.start", payload: { name: "mlx" } });
	            } catch {
	              // ignore
	            }
	          })();
	        }
	      };

      try {
        if (!opts?.forceManaged) {
          await tryConnect(preferredHost, preferredPort, "engine");
          return;
        }
      } catch {
        addSystemMessage("[runtime] engine not reachable; switching to managed backend…", { silent: true });
        // fall through to managed-mode connection below
      }

      if (!isLocalHost(preferredHost)) {
        connectionStatus = "error";
        error = "Engine not reachable";
        addSystemMessage(`Failed to connect to ws://${preferredHost}:${preferredPort}. (Autostart disabled for non-local host.)`);
        updateAll();
        return;
      }

      // 1) Managed engine reuse (off by default in dev so code changes take effect without manual restarts).
      const state = await readEngineStateFile(enginePaths.stateFile);
      const reuseManaged = process.env.AGENTLOOP_REUSE_MANAGED_ENGINE === "1";
      if (state && isPidAlive(state.pid) && reuseManaged) {
        try {
          await tryConnect(state.host, state.port, "managed engine");
          return;
        } catch {
          // ignore and start a new one below
        }
      }
      // If we aren't reusing, stop any existing managed engine referenced by the state file.
      if (state && isPidAlive(state.pid) && !reuseManaged) {
        await stopManagedEngine({ stateFile: enginePaths.stateFile }).catch(() => {});
      }

      // 2) Start a managed engine on an ephemeral port (avoids port conflicts).
      addSystemMessage(`[runtime] starting managed backend…`, { silent: true });
      try {
        managedEngineProc?.kill?.();
      } catch {
        // ignore
      }
      managedEngineProc = spawnManagedEngine({
        engineDir: enginePaths.engineDir,
        stateFile: enginePaths.stateFile,
        host: preferredHost,
      });
      try {
        (managedEngineProc as any)?.unref?.();
      } catch {
        // ignore
      }

      const nextState = await waitForEngineStateFile({ stateFile: enginePaths.stateFile });
      if (!nextState) {
        connectionStatus = "error";
        error = "Engine did not become ready";
        addSystemMessage(`[runtime] failed to start (no state file written): ${enginePaths.stateFile}`, { silent: true });
        updateAll();
        return;
      }

      try {
        await tryConnect(nextState.host, nextState.port, "managed engine");
        addSystemMessage(`[runtime] managed backend ready (pid ${nextState.pid})`, { silent: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        connectionStatus = "error";
        error = msg;
        addSystemMessage(`[runtime] failed to connect after start: ${msg}`, { silent: true });
        updateAll();
      }
    })().finally(() => {
      connectPromise = null;
    });
    return connectPromise;
  };

  // Streaming batching (avoid repainting per-token)
  let streamingBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushStreaming = () => {
    streamingContent = streamingBuffer;
    flushTimer = null;
    requestRender();
  };

  const send = (command: Command) => {
    log.data("send command", command);
    engine.send(command);
  };

  const newSession = () => {
    messages = [];
    streamingContent = "";
    streamingBuffer = "";
    sessionStatus = "idle";
    const next = createId();
    sessionId = next;
    log.info(`new session: ${next}`);
    if (connectionStatus === "connected") {
      send({ type: "session.create", payload: { sessionId: next } });
      addSystemMessage("New session.");
    } else {
      addSystemMessage("New session (will create when connected).");
    }
  };

  const sendMessage = (content: string) => {
    if (!ensureEngineConnected({ quiet: true })) {
      addSystemMessage("Tip: press ^R to reconnect/start backend.");
      return;
    }
    log.data("user message", { content, length: content.length });
    pendingPerf = { startedAt: Date.now(), contentLength: content.length, tokens: 0 };
    const userMessage: Message = { id: createId(), role: "user", content, timestamp: Date.now() };
    messages = [...messages, userMessage];
    send({ type: "session.send", payload: { sessionId, content } });
    requestRender();
  };

  const ensureEngineConnected = (opts?: { quiet?: boolean }): boolean => {
    if (connectionStatus !== "connected") {
      if (!opts?.quiet) addSystemMessage("Not connected to engine.");
      return false;
    }
    return true;
  };

  const insertIntoComposer = (text: string) => {
    textarea.setText(text);
    textarea.cursorOffset = text.length;
    renderer.focusRenderable(textarea);
    textarea.focus();
    requestRender();
  };

  const copyText = async (text: string, label: string) => {
    const trimmed = text.trimEnd();
    if (!trimmed) {
      addSystemMessage(`Nothing to copy (${label}).`);
      return;
    }
    addSystemMessage(`Copying: ${label}…`);
    const ok = await tryCopyToClipboard(trimmed);
    addSystemMessage(ok ? "Copied." : "Copy failed (clipboard tool not found). On macOS, ensure `pbcopy` is available.");
  };

  const copySelection = async () => {
    const selected = getSelectionText();
    if (!selected.trim()) {
      addSystemMessage("Nothing selected. Drag to select text, then use Cmd/Ctrl+C (or Quick Actions → copy sel).");
      return;
    }
    await copyText(selected, "selection");
  };

  function getLastAssistantMessage(): string {
    return [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  }

  function getLastAudioPath(): string {
    for (const m of [...messages].reverse()) {
      const p = maybeExtractPath(m.content);
      if (p) return p;
    }
    return "";
  }

  function getLastCodeBlock(): string {
    const lastAssistant = getLastAssistantMessage();
    const blocks = extractCodeBlocks(lastAssistant);
    return blocks[0]?.code ?? "";
  }

  const normalizeServiceName = (raw: string): ServiceName | null => {
    const n = raw.trim().toLowerCase();
    if (!n) return null;
    if (n === "kokomo") return "kokomo";
    if (n === "mlx") return "mlx";
    if (n === "vlm") return "vlm";
    const aliases: Record<string, ServiceName> = {
      kokama: "kokomo",
      koko: "kokomo",
      kokomo1: "kokomo",
      m: "mlx",
      llm: "mlx",
      local: "mlx",
      vision: "vlm",
      image: "vlm",
    };
    if (aliases[n]) return aliases[n];
    if (n.startsWith("koko")) return "kokomo";
    return null;
  };

  const requestServiceStatus = (name?: ServiceName) => {
    if (!ensureEngineConnected()) return;
    send({ type: "service.status", payload: { name } });
    if (name) setToast(`service: ${name} status…`);
  };

  const requestAgentList = () => {
    if (!ensureEngineConnected()) return;
    pendingAgentList = true;
    send({ type: "agent.list", payload: {} });
    setToast("agents: list…");
  };

  const configureSession = (payload: { routingMode?: "auto" | "pinned"; agent?: string | null; sessionPrompt?: string | null }) => {
    if (!ensureEngineConnected()) return;
    send({ type: "session.configure", payload: { sessionId, ...payload } });
  };

  const startService = (name: ServiceName) => {
    if (!ensureEngineConnected()) return;
    // Switch the sidebar to the relevant logs immediately for better feedback.
    activeLogService = name;
    // Expand logs section if it was collapsed.
    logsCollapsed = false;
    logsServiceTabs.visible = true;
    logsScroll.visible = true;
    setToast(`service: ${name} start…`);
    send({ type: "service.start", payload: { name } });
    requestServiceStatus(name);
    updateSidebar();
    requestRender();
  };

  const stopService = (name: ServiceName) => {
    if (!ensureEngineConnected()) return;
    setToast(`service: ${name} stop…`);
    send({ type: "service.stop", payload: { name } });
    requestServiceStatus(name);
    requestRender();
  };

  const ensureKokomoRunning = async (): Promise<boolean> => {
    if (!ensureEngineConnected()) return false;
    const current = services["kokomo"];
    if (current?.status === "running") return true;
    addSystemMessage("[say] starting kokomo…", { silent: true });
    send({ type: "service.start", payload: { name: "kokomo" } });

    const start = Date.now();
    while (Date.now() - start < 15_000) {
      const s = services["kokomo"];
      if (s?.status === "running") return true;
      if (s?.status === "error") return false;
      if (s?.status === "stopped" && s.lastError) return false;
      requestServiceStatus("kokomo");
      await Bun.sleep(250);
    }
    return false;
  };

  const runSlashCommand = (raw: string) => {
    const trimmed = raw.trim();
    const parts = trimmed.replace(/^\//, "").split(/\s+/).filter(Boolean);
    const cmd = (parts[0] ?? "").toLowerCase();
    log.data("slash command", { raw, cmd, args: parts.slice(1) });

      const helpText = [
        "Commands:",
        "  /help",
        "  /agent list",
        "  /agent set <name>   (pins an agent)",
        "  /agent auto         (router decides)",
        "  /prompt show",
        "  /prompt set <text>",
        "  /prompt clear",
        "  /say <text>",
        "  /install list",
        "  /install kokomo|mlx [--yes]",
        "  /install vlm [--yes]",
        "  /install mlx-model <modelId> [--yes]",
        "  /copy last",
        "  /copy <text>",
        "  /commit <message> [--yes] [--all] [--amend]",
        "  /service kokomo|mlx|vlm start|stop|status",
        "  /runtime start|stop|restart|status   (managed backend)",
        "  /kokomo start|stop|status",
        "  /mlx start|stop|status",
        "  /vlm start|stop|status",
        "  /logo <domain>  (download logo PNG to cache)",
        "",
        "Tips:",
        "  /install runs local commands only when you pass --yes.",
        "  /commit will not run unless you pass --yes.",
        "  If /say fails, run: /install kokomo --yes",
        "  If chat says no LLM, run: /install mlx --yes  →  /service mlx start",
      ].join("\n");

    if (!cmd || cmd === "help") {
      addSystemMessage(helpText);
      return;
    }

    if (cmd === "agent") {
      const sub = (parts[1] ?? "list").toLowerCase();
      if (sub === "list") {
        requestAgentList();
        return;
      }
      if (sub === "auto") {
        routingMode = "auto";
        activeAgentName = null;
        configureSession({ routingMode: "auto", agent: null });
        setToast("agent: auto");
        requestRender();
        return;
      }
      if (sub === "set" || sub === "pin") {
        const name = (parts[2] ?? "").trim();
        if (!name) {
          addSystemMessage("Usage: /agent set <name>");
          return;
        }
        routingMode = "pinned";
        activeAgentName = name;
        configureSession({ routingMode: "pinned", agent: name });
        setToast(`agent: pinned (${name})`);
        requestRender();
        return;
      }
      addSystemMessage("Usage: /agent list | /agent set <name> | /agent auto");
      return;
    }

    if (cmd === "prompt") {
      const sub = (parts[1] ?? "show").toLowerCase();
      if (sub === "show") {
        addSystemMessage(
          [
            "Session prompt:",
            sessionPromptOverride?.trim() ? sessionPromptOverride.trim() : "(none)",
            "",
            "Commands:",
            "  /prompt set <text>",
            "  /prompt clear",
          ].join("\n")
        );
        return;
      }
      if (sub === "clear" || sub === "reset") {
        sessionPromptOverride = null;
        configureSession({ sessionPrompt: null });
        setToast("prompt: cleared");
        return;
      }
      if (sub === "set") {
        const text = parts.slice(2).join(" ").trim();
        if (!text) {
          addSystemMessage("Usage: /prompt set <text>");
          return;
        }
        sessionPromptOverride = text;
        configureSession({ sessionPrompt: text });
        setToast("prompt: set");
        return;
      }
      addSystemMessage("Usage: /prompt show | /prompt set <text> | /prompt clear");
      return;
    }

    if (cmd === "install") {
      const sub = (parts[1] ?? "").toLowerCase();
      const yes = parts.includes("--yes") || parts.includes("-y");
      const argRest = parts.slice(2).filter((p) => p !== "--yes" && p !== "-y");

      const showList = () => {
        addSystemMessage(
          [
            "Install targets:",
            "  kokomo     - local TTS (mlx-audio[tts])",
            "  mlx        - MLX LLM tooling (mlx-lm)",
            "  vlm        - MLX VLM tooling (mlx-vlm)",
            "  mlx-model  - prefetch an MLX model",
            "",
            "Examples:",
            "  /install kokomo --yes",
            "  /install mlx --yes",
            "  /install vlm --yes",
            "  /install mlx-model mlx-community/Llama-3.2-3B-Instruct-4bit --yes",
          ].join("\n")
        );
      };

      if (!sub || sub === "list") {
        showList();
        return;
      }

      const id = sub as InstallerId;
      const spec = installers[id];
      if (!spec) {
        addSystemMessage(`Unknown install target "${sub}". Try: /install list`);
        return;
      }

      const preview = [
        `Installer: ${spec.title}`,
        spec.description,
        "",
        ...spec.preview.map((l) => `- ${l}`),
        "",
      ];

      if (!yes) {
        addSystemMessage(
          preview
            .concat([
              "This will run local commands on your machine.",
              `Re-run with: /install ${sub}${argRest.length ? ` ${argRest.join(" ")}` : ""} --yes`,
            ])
            .join("\n")
        );
        return;
      }

      addSystemMessage(`[install] starting: ${spec.id}`);
      void (async () => {
        try {
          const { cmd, cwd } = spec.run(argRest);
          log.info(`[install:${spec.id}] start cmd=${formatCmd(cmd)} cwd=${cwd}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addSystemMessage(`[install:${spec.id}] failed before start: ${msg}`);
          log.error(`[install:${spec.id}] failed before start: ${msg}`);
          return;
        }

        const code = await runInstaller(spec, argRest, (line) => {
          addSystemMessage(`[install:${spec.id}] ${line}`, { silent: true });
          log.info(`[install:${spec.id}] ${line}`);
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          addSystemMessage(`[install:${spec.id}] failed: ${msg}`);
          log.error(`[install:${spec.id}] failed: ${msg}`);
          return 1;
        });

        addSystemMessage(code === 0 ? `[install:${spec.id}] done` : `[install:${spec.id}] exited with code ${code}`);
        log.info(`[install:${spec.id}] exit code=${code}`);
      })();
      return;
    }

    if (cmd === "logo") {
      const domain = parts[1];
      if (!domain) {
        addSystemMessage("Usage: /logo <domain>");
        return;
      }
      addSystemMessage(`[logo] fetching ${domain}…`);
      log.info(`[logo] fetch start: ${domain}`);
      void (async () => {
        try {
          const { filePath, url, bytes, cached } = await fetchLogoToCache({ domain });
          addSystemMessage(
            [
              `[logo] ${domain}`,
              `  url: ${url}`,
              `  file: ${filePath}`,
              `  bytes: ${bytes}${cached ? " (cached)" : ""}`,
            ].join("\n")
          );
          log.info(`[logo] fetched ${domain} bytes=${bytes} file=${filePath} cached=${cached}`);
          const copied = await tryCopyToClipboard(filePath);
          if (copied) addSystemMessage("[logo] copied file path to clipboard");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addSystemMessage(`[logo] failed: ${msg}`);
          log.error(`[logo] failed: ${msg}`);
        }
      })();
      return;
    }

    if (cmd === "copy") {
      const what = parts.slice(1).join(" ").trim();
      if (!what) {
        addSystemMessage("Usage: /copy last|<text>");
        return;
      }

      const target =
        what.toLowerCase() === "last"
          ? [...messages].reverse().find((m) => m.role === "assistant")?.content ?? ""
          : what;

      if (!target.trim()) {
        addSystemMessage("Nothing to copy.");
        return;
      }

      addSystemMessage("Copying to clipboard…");
      void (async () => {
        const ok = await tryCopyToClipboard(target);
        addSystemMessage(ok ? "Copied." : "Copy failed (clipboard tool not found).");
      })();
      return;
    }

    if (cmd === "commit") {
      const yes = parts.includes("--yes") || parts.includes("-y");
      const all = parts.includes("--all") || parts.includes("-a");
      const amend = parts.includes("--amend");

      const message = parts
        .slice(1)
        .filter((p) => !["--yes", "-y", "--all", "-a", "--amend"].includes(p))
        .join(" ")
        .trim();

      if (!message) {
        addSystemMessage("Usage: /commit <message> [--yes] [--all] [--amend]");
        return;
      }

      void (async () => {
        const cwd = enginePaths.repoRoot;

        const status = await runGit({ cwd, args: ["status", "--porcelain"] });
        const changes = (status.stdout ?? "").trimEnd();

        if (!yes) {
          addSystemMessage("[git] /commit is a local write action; re-run with --yes to proceed.");
          addSystemMessage(`[git] message: ${message}`);
          addSystemMessage(`[git] flags: ${[all ? "--all" : "", amend ? "--amend" : ""].filter(Boolean).join(" ") || "(none)"}`);
          addSystemMessage(changes ? `[git] pending changes:\n${changes}` : "[git] pending changes: (none)");
          return;
        }

        if (all) {
          addSystemMessage("[git] staging: git add -A");
          const addRes = await runGit({ cwd, args: ["add", "-A"] });
          if (!addRes.ok) {
            addSystemMessage(`[git] add failed (code ${addRes.exitCode})`);
            const out = [addRes.stdout, addRes.stderr].join("\n").trim();
            if (out) addSystemMessage(`[git] ${out}`);
            return;
          }
        }

        addSystemMessage(`[git] committing${amend ? " (amend)" : ""}…`);
        const args = ["commit", "-m", message];
        if (amend) args.push("--amend");
        const commitRes = await runGit({ cwd, args });
        if (!commitRes.ok) {
          addSystemMessage(`[git] commit failed (code ${commitRes.exitCode})`);
          const out = [commitRes.stdout, commitRes.stderr].join("\n").trim();
          if (out) addSystemMessage(`[git] ${out}`);
          return;
        }

        const out = commitRes.stdout.trimEnd();
        addSystemMessage(out ? `[git] ${out}` : "[git] committed.");
      })();
      return;
    }

    if (cmd === "service" || cmd === "svc") {
      const a1 = (parts[1] ?? "").toLowerCase();
      const a2 = (parts[2] ?? "").toLowerCase();

      // Support both:
      // - /service <name> <action>
      // - /service <action> [name]   (uses activeService by default)
      const isAction = (x: string) => x === "start" || x === "stop" || x === "status";
      const action = isAction(a1) ? a1 : isAction(a2) ? a2 : "status";
      const nameRaw = isAction(a1) ? parts[2] ?? "" : parts[1] ?? "";
      const name = normalizeServiceName(nameRaw) ?? (isAction(a1) ? activeService : null);
      if (!name) {
        addSystemMessage(`Usage: /service kokomo|mlx|vlm start|stop|status`);
        return;
      }
      if (action === "start") return startService(name);
      if (action === "stop") return stopService(name);
      if (action === "status") {
        requestServiceStatus(name);
        return;
      }
      addSystemMessage(`Unknown action "${action}". Try: start|stop|status`);
      return;
    }

    if (cmd === "kokomo") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") return startService("kokomo");
      if (action === "stop") return stopService("kokomo");
      requestServiceStatus("kokomo");
      return;
    }

    if (cmd === "mlx" || cmd === "llm") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") return startService("mlx");
      if (action === "stop") return stopService("mlx");
      requestServiceStatus("mlx");
      return;
    }

    if (cmd === "vlm" || cmd === "vision") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") return startService("vlm");
      if (action === "stop") return stopService("vlm");
      requestServiceStatus("vlm");
      return;
    }

    if (cmd === "runtime" || cmd === "rt" || cmd === "backend") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") {
        engine.disconnect();
        void connectToEngine({ forceManaged: true });
        return;
      }
      if (action === "stop") {
        addSystemMessage("[runtime] stopping managed backend…");
        void (async () => {
          const res = await stopManagedEngine({ stateFile: enginePaths.stateFile });
          engine.disconnect();
          addSystemMessage(res.ok ? `[runtime] ${res.detail}` : `[runtime] stop: ${res.detail}`);
        })();
        return;
      }
      if (action === "restart") {
        addSystemMessage("[runtime] restarting managed backend…");
        void (async () => {
          await stopManagedEngine({ stateFile: enginePaths.stateFile }).catch(() => {});
          engine.disconnect();
          await connectToEngine({ forceManaged: true });
        })();
        return;
      }
      // status (default)
      void (async () => {
        const state = await readEngineStateFile(enginePaths.stateFile);
        if (!state) {
          addSystemMessage(`[runtime] managed backend: (none)  stateFile=${enginePaths.stateFile}`);
          addSystemMessage(`[runtime] configured target: ws://${engineHost}:${enginePort}`);
          return;
        }
        const alive = isPidAlive(state.pid);
        addSystemMessage(
          `[runtime] managed backend: ${alive ? "running" : "stale"}  pid=${state.pid}  ws://${state.host}:${state.port}`
        );
        addSystemMessage(`[runtime] stateFile=${enginePaths.stateFile}`);
      })();
      return;
    }

    if (cmd === "say" || cmd === "tts") {
      const text = parts.slice(1).join(" ").trim();
      if (!text) {
        addSystemMessage("Usage: /say <text>");
        return;
      }

      addSystemMessage("[say] synthesizing…");
      void (async () => {
        try {
          let filePath: string;
          let bytes: number;

          const ready = await ensureKokomoRunning();
          if (ready) {
            addSystemMessage("[say] calling kokomo /tts…");
            ({ filePath, bytes } = await kokomoTtsToWavFile(text));
          } else {
            const state = services["kokomo"];
            addSystemMessage(
              `[say] kokomo not running; using local mlx-audio…${state?.lastError ? ` (${state.lastError})` : ""}`
            );
            ({ filePath, bytes } = await kokomoTtsLocalToWavFile(text));
          }

          addSystemMessage(`[say] saved wav (${bytes} bytes): ${filePath}`);
          const copied = await tryCopyToClipboard(filePath);
          if (copied) addSystemMessage("[say] copied file path to clipboard");
          addSystemMessage("[say] playing…");
          const played = await tryPlayAudioFile(filePath);
          addSystemMessage(played ? "[say] played" : "[say] could not auto-play (file saved)");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addSystemMessage(`[say] failed: ${msg}`);
          if (msg.toLowerCase().includes("run `bun run kokomo:install")) {
            addSystemMessage("Tip: /install kokomo --yes");
          }
        }
      })();
      return;
    }

    addSystemMessage(`Unknown command "/${cmd}". Try /help`);
    log.error(`unknown slash command: /${cmd}`);
  };

  const submitInput = () => {
    const value = textarea.plainText.trimEnd();
    textarea.setText("");
    textarea.cursorOffset = 0;
    historyIndex = null;
    if (!value.trim()) return;

    // History should store what the user typed (commands + messages).
    history.push(value);
    if (history.length > 200) history.splice(0, history.length - 200);

    if (value.trimStart().startsWith("/")) {
      runSlashCommand(value);
      return;
    }

    if (sessionStatus === "thinking" || sessionStatus === "streaming") {
      addSystemMessage("Agent is responding; please wait (or /help).");
      return;
    }

    sendMessage(value);
  };

  textarea.onSubmit = submitInput;

  serviceActions.on(TabSelectRenderableEvents.ITEM_SELECTED, () => {
    const opt = serviceActions.getSelectedOption();
    const action = String(opt?.value ?? "");
    if (action === "start") startService(activeService);
    else if (action === "stop") stopService(activeService);
    else requestServiceStatus(activeService);
  });

  serviceTabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, () => {
    const opt = serviceTabs.getSelectedOption();
    const name = String(opt?.value ?? opt?.name ?? "").trim();
    if (name === "kokomo" || name === "mlx" || name === "vlm") {
      activeService = name;
      requestServiceStatus(name);
      if (serviceSelectionAnnounceEnabled) setToast(`active service: ${name}`);
      requestRender();
    }
  });

  logsServiceTabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, () => {
    const opt = logsServiceTabs.getSelectedOption();
    const name = String(opt?.value ?? opt?.name ?? "").trim();
    if (name) {
      activeLogService = name;
      updateSidebar();
      requestRender();
    }
  });

  actionTabs.on(TabSelectRenderableEvents.ITEM_SELECTED, () => {
    const opt = actionTabs.getSelectedOption();
    const action = String(opt?.value ?? "");
    if (action === "copy_last") void copyText(getLastAssistantMessage(), "last assistant message");
    else if (action === "copy_sel") void copySelection();
    else if (action === "copy_code") void copyText(getLastCodeBlock(), "last code block");
    else if (action === "copy_wav") void copyText(getLastAudioPath(), "last audio path");
  });

  presetsTabs.on(TabSelectRenderableEvents.ITEM_SELECTED, () => {
    const opt = presetsTabs.getSelectedOption();
    const text = String(opt?.value ?? "");
    if (!text) return;
    insertIntoComposer(text);
  });

  // Keyboard shortcuts (priority over focused renderable)
  renderer._internalKeyInput.onInternal("keypress", (key) => {
    // Splash: Enter to proceed
    if (screen === "splash") {
      if (key.ctrl && key.name === "c") {
        key.preventDefault();
        destroy();
        process.exit(0);
      }
      if (key.ctrl && key.name === "a") {
        key.preventDefault();
        setScreen("main");
        setAboutOpen(true);
      }
      if (key.name === "return" || key.name === "linefeed" || key.name === "escape") {
        key.preventDefault();
        setScreen("main");
      }
      return;
    }

    // About modal
    if (aboutOpen) {
      if (key.name === "escape" || (key.ctrl && key.name === "a")) {
        key.preventDefault();
        setAboutOpen(false);
      }
      return;
    }

    // Copy selection (conversation/sidebar/composer)
    if ((key.ctrl || key.meta || key.super) && key.name === "c") {
      if (renderer.hasSelection) {
        key.preventDefault();
        const selected = getSelectionText().trimEnd();
        if (selected.trim()) {
          void (async () => {
            const ok = await tryCopyToClipboard(selected);
            if (ok) {
              addSystemMessage(`[copy] copied selection (${selected.length} chars)`);
              requestRender();
            } else {
              addSystemMessage("[copy] failed (clipboard tool not found)");
            }
          })();
          return;
        }
      }
    }

    // Quit (only when not copying a selection)
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      const now = Date.now();
      if (now - quitArmedAt < 750) {
        destroy();
        process.exit(0);
      }
      quitArmedAt = now;
      addSystemMessage("Press ^C again to quit.");
      return;
    }

    // Copy last assistant
    if (key.ctrl && key.name === "y") {
      key.preventDefault();
      void copyText(getLastAssistantMessage(), "last assistant message");
      return;
    }

    // About
    if (key.ctrl && key.name === "a") {
      key.preventDefault();
      setAboutOpen(true);
      return;
    }

    // New session
    if (key.ctrl && key.name === "n") {
      key.preventDefault();
      newSession();
      return;
    }

    // Reconnect
    if (key.ctrl && key.name === "r") {
      key.preventDefault();
      engine.disconnect();
      void connectToEngine().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        addSystemMessage(`Reconnect failed: ${msg}`);
      });
      return;
    }

    // Focus cycle
    if (!key.ctrl && !key.meta && key.name === "tab") {
      key.preventDefault();
      const order = [textarea, conversationScroll, sidebarScroll, logsScroll, serviceActions, actionTabs, presetsTabs].filter(
        (r) => r.visible
      );
      const current = renderer.currentFocusedRenderable;
      const idx = order.findIndex((r) => r === current);
      const delta = key.shift ? -1 : 1;
      const next = order[(idx < 0 ? 0 : (idx + delta + order.length) % order.length)] ?? textarea;
      renderer.focusRenderable(next);
      next.focus();
      return;
    }

    // History (Up/Down) when cursor is at edge
    if (!key.ctrl && !key.meta && !key.shift && (key.name === "up" || key.name === "down")) {
      if (renderer.currentFocusedRenderable !== textarea) return;
      const cursorRow = textarea.logicalCursor.row;
      const isAtTop = cursorRow === 0;
      const isAtBottom = cursorRow === textarea.lineCount - 1;
      const canUseUp = key.name === "up" && isAtTop;
      const canUseDown = key.name === "down" && isAtBottom;

      if (!canUseUp && !canUseDown) return;
      if (history.length === 0) return;

      key.preventDefault();
      if (historyIndex == null) {
        historyIndex = history.length;
      }

      historyIndex += key.name === "up" ? -1 : 1;
      if (historyIndex < 0) historyIndex = 0;
      if (historyIndex > history.length) historyIndex = history.length;

      const nextValue = historyIndex === history.length ? "" : history[historyIndex] ?? "";
      textarea.setText(nextValue);
      textarea.cursorOffset = nextValue.length;
      return;
    }
  });

  const handleEngineEvent = (event: EngineEvent) => {
    // Avoid spamming logs with per-token streaming events; perf logging covers this path.
    if (event.type !== "assistant.token") log.data("engine event", event);
    switch (event.type) {
      case "session.created":
        sessionId = event.sessionId;
        break;
      case "session.status":
        sessionStatus = event.status;
        if (event.status === "streaming") {
          streamingBuffer = "";
          streamingContent = "";
        }
        break;
      case "router.decision":
        routingMode = event.routingMode;
        activeAgentName = event.agent;
        lastRouterReason = event.reason ?? null;
        lastRouterMs = event.durationMs ?? null;
        break;
      case "agent.list":
        lastAgentList = event.agents;
        if (pendingAgentList) {
          pendingAgentList = false;
          const lines = [
            "Agents:",
            ...event.agents.map((a) => `- ${a.name}${a.description ? ` — ${a.description}` : ""}  (tools: ${a.tools.join(", ") || "none"})`),
          ];
          addSystemMessage(lines.join("\n"));
        }
        break;
      case "assistant.token":
        streamingBuffer += event.token;
        if (pendingPerf) {
          pendingPerf.tokens += 1;
          if (!pendingPerf.firstTokenAt) {
            pendingPerf.firstTokenAt = Date.now();
            log.data("perf.first_token", {
              ms: pendingPerf.firstTokenAt - pendingPerf.startedAt,
              contentLength: pendingPerf.contentLength,
            });
          }
        }
        if (!flushTimer) flushTimer = setTimeout(flushStreaming, 200);
        break;
      case "assistant.message":
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        streamingContent = streamingBuffer;
        streamingBuffer = "";
        addMessage({ id: event.messageId, role: "assistant", content: event.content, timestamp: Date.now() });
        log.data("assistant message", { id: event.messageId, content: event.content });
        if (pendingPerf) {
          const doneAt = Date.now();
          log.data("perf.complete", {
            ms: doneAt - pendingPerf.startedAt,
            ttfbMs: pendingPerf.firstTokenAt ? pendingPerf.firstTokenAt - pendingPerf.startedAt : null,
            contentLength: pendingPerf.contentLength,
            tokenEvents: pendingPerf.tokens,
            responseLength: event.content.length,
          });
          pendingPerf = null;
        }
        streamingContent = "";
        break;
      case "tool.call":
        log.data("tool call", event.tool);
        break;
      case "tool.result":
        log.data("tool result", { toolId: event.toolId, result: event.result });
        break;
      case "service.status":
        services = { ...services, [event.service.name]: event.service };
        log.data("service status", event.service);
        break;
      case "service.log":
        {
          const line = `${event.stream === "stderr" ? "!" : " "} ${event.line}`;
          const existing = serviceLogs[event.name] ?? [];
          const next = [...existing, line];
          serviceLogs = { ...serviceLogs, [event.name]: clampLines(next, 400) };
          recentServiceFeed.push(`${event.name} ${line}`.slice(0, 140));
          if (recentServiceFeed.length > 60) recentServiceFeed.splice(0, recentServiceFeed.length - 60);
        }
        break;
      case "error":
        error = event.error;
        if (connectionStatus !== "connected") connectionStatus = "error";
        log.error(`engine error: ${event.error}`);
        break;
    }
    updateAll();
  };

  engine.on("event", handleEngineEvent);
  engine.on("connected", () => {
    connectionStatus = "connected";
    error = null;
    log.info("engine connected");
    updateAll();
  });
  engine.on("disconnected", () => {
    connectionStatus = "disconnected";
    log.info("engine disconnected");
    updateAll();
  });

  renderer.start();
  applyScreenVisibility();
  requestRender();
}
