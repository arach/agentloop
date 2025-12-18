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
import { installers, runInstaller, type InstallerId } from "./utils/installers.js";
import { kokomoTtsLocalToWavFile, kokomoTtsToWavFile, tryPlayAudioFile } from "./utils/kokomo.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

const theme = {
  bg: "#0b0b0b",
  panelBg: "#0f0f0f",
  border: "#3a3a3a",
  borderFocused: "#8a8a8a",
  fg: "#eaeaea",
  muted: "#a8a8a8",
  dim: "#7a7a7a",
  dim2: "#5a5a5a",
  selectionBg: "#2a2a2a",
  selectionFg: "#ffffff",
};

type Screen = "splash" | "main";

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n");
}

function extractCodeBlocks(markdown: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  for (const m of normalizeNewlines(markdown).matchAll(re)) {
    blocks.push({ lang: (m[1] ?? "").trim(), code: (m[2] ?? "").trimEnd() });
  }
  return blocks;
}

function maybeExtractPath(text: string): string | null {
  const m = text.match(/\b\/(?:[^\s]+\/)*[^\s]+\.(?:wav|mp3|m4a)\b/);
  return m?.[0] ?? null;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function clampLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  return lines.slice(lines.length - max);
}

export async function runTui(options: { engineHost?: string; enginePort?: number }): Promise<void> {
  const engineHost = options.engineHost ?? DEFAULT_CONFIG.engineHost;
  const enginePort = options.enginePort ?? DEFAULT_CONFIG.enginePort;

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
    padding: 1,
    gap: 1,
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
    top: "10%",
    left: "10%",
    width: "80%",
    height: "80%",
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
    backgroundColor: theme.panelBg,
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
      "^C          quit",
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
    height: 3,
    border: true,
    borderColor: theme.border,
    focusedBorderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    paddingLeft: 1,
    paddingRight: 1,
    justifyContent: "center",
  });
  const headerText = new TextRenderable(renderer, {
    id: "headerText",
    fg: theme.fg,
    wrapMode: "none",
    selectable: false,
    flexGrow: 1,
  });
  header.add(headerText);
  root.add(header);

  // Main row (conversation + sidebar)
  const mainRow = new BoxRenderable(renderer, {
    id: "mainRow",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 1,
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
    onMouseDown: () => renderer.focusRenderable(conversationScroll),
  });
  mainRow.add(conversationPanel);

  const conversationTitle = new TextRenderable(renderer, {
    id: "conversationTitle",
    content: "Conversation",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  conversationPanel.add(conversationTitle);

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
    width: "28%",
    minWidth: 26,
    maxWidth: 48,
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

  let servicesCollapsed = false;
  const servicesTitle = new TextRenderable(renderer, {
    id: "servicesTitle",
    content: "Services (click to toggle)",
    fg: theme.muted,
    wrapMode: "none",
    selectable: false,
    height: 1,
    onMouseDown: () => {
      servicesCollapsed = !servicesCollapsed;
      servicesText.visible = !servicesCollapsed;
      serviceActions.visible = !servicesCollapsed;
      requestRender();
    },
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
    selectedBackgroundColor: theme.bg,
    selectedTextColor: theme.fg,
    options: [
      { name: "kokomo", description: "Kokomo TTS", value: "kokomo" },
      { name: "mlx", description: "MLX LLM", value: "mlx" },
      { name: "vlm", description: "MLX VLM", value: "vlm" },
    ],
  });
  servicesSection.add(serviceTabs);

  const servicesText = new TextRenderable(renderer, {
    id: "servicesText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "word",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
  });
  servicesSection.add(servicesText);

  const serviceActions = new TabSelectRenderable(renderer, {
    id: "serviceActions",
    height: 3,
    tabWidth: 10,
    showDescription: false,
    showUnderline: true,
    wrapSelection: true,
    backgroundColor: theme.panelBg,
    textColor: theme.dim,
    focusedBackgroundColor: theme.panelBg,
    focusedTextColor: theme.fg,
    selectedBackgroundColor: theme.bg,
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
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panelBg } },
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
    selectedBackgroundColor: theme.bg,
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
    selectedBackgroundColor: theme.bg,
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
    selectedBackgroundColor: theme.bg,
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
    gap: 1,
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
    onMouseDown: () => renderer.focusRenderable(textarea),
  });
  footer.add(inputBox);

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
  let sessionId: string | null = null;
  let sessionStatus: "idle" | "thinking" | "streaming" | "tool_use" | "error" = "idle";
  let error: string | null = null;
  let streamingContent = "";
  let messages: Message[] = [];
  let services: Record<string, ServiceState> = {};
  let serviceLogs: Record<string, string[]> = {};
  let lastServiceStatusLineByName: Record<string, string> = {};

  // Command history
  const history: string[] = [];
  let historyIndex: number | null = null;

  // Sidebar state
  let activeLogService: string = "kokomo";
  let lastLogTabsKey = "";
  let servicesTabsSynced = false;

  const engine = new EngineWsClient({ host: engineHost, port: enginePort });

  const requestRender = () => renderer.requestRender();

  const addMessage = (m: Message) => {
    messages = [...messages, m];
    requestRender();
  };

  const addSystemMessage = (content: string) => {
    addMessage({ id: createId(), role: "system", content, timestamp: Date.now() });
  };

  const getSelectionText = () => renderer.getSelectionContainer()?.getSelectedText?.() ?? "";

  const updateHeader = () => {
    const conn =
      connectionStatus === "connected"
        ? "● connected"
        : connectionStatus === "connecting"
          ? "◐ connecting"
          : connectionStatus === "error"
            ? "● error"
            : "○ disconnected";
    const sId = sessionId ? `Session: ${sessionId}` : "Session: —";
    const sStatus = `Status: ${sessionStatus}`;
    const err = error ? `\nError: ${error}` : "";
    headerText.content = `AgentLoop • ${conn} • ${sStatus}\n${sId}${err}`;
  };

  const updateConversation = () => {
    const lines: string[] = [];
    for (const m of messages) {
      const who = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
      lines.push(`• ${who} • ${formatTime(m.timestamp)}`);
      lines.push(m.content.trimEnd());
      lines.push("");
    }
    if (sessionStatus === "streaming" && streamingContent.trim()) {
      lines.push(`• Assistant • ${formatTime(Date.now())}`);
      lines.push(streamingContent.trimEnd());
      lines.push("");
    }
    conversationText.content = lines.join("\n").trimEnd();
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
        "Tip: Quick Actions → copy sel",
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
    const svcLines: string[] = [];
    const known: ServiceName[] = ["kokomo", "mlx"];
    for (const name of known) {
      const svc = services[name];
      if (!svc) {
        svcLines.push(`${name} · (unknown)`);
        continue;
      }
      const pid = svc.pid ? ` pid=${svc.pid}` : "";
      const detail = svc.detail ? ` — ${svc.detail}` : "";
      svcLines.push(`${name} · ${svc.status}${pid}${detail}`);
      if (svc.lastExitCode != null) svcLines.push(`  lastExitCode: ${svc.lastExitCode}`);
      if (svc.lastError) svcLines.push(`  lastError: ${svc.lastError}`);
    }
    servicesText.content = svcLines.join("\n");

    if (!servicesTabsSynced) {
      // Ensure service tab selection starts on kokomo.
      serviceTabs.setSelectedIndex(activeService === "mlx" ? 1 : 0);
      servicesTabsSynced = true;
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
    helpBar.content =
      "Enter send · Shift+Enter newline · Tab focus · ↑/↓ history · ^Y copy last · ^A about · ^N new · ^R reconnect · ^C quit";
  };

  const updateAll = () => {
    updateHeader();
    updateConversation();
    updateInspector();
    updateSidebar();
    updateHelp();
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

  let connectStarted = false;
  const connectToEngine = async () => {
    if (connectStarted) return;
    connectStarted = true;

    addSystemMessage(`Connecting to engine at ws://${engineHost}:${enginePort}…`);
    connectionStatus = "connecting";
    error = null;
    updateAll();

    try {
      await engine.connect();
      connectionStatus = "connected";
      error = null;
      updateAll();
      engine.send({ type: "service.status", payload: { name: "kokomo" } } as Command);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      connectionStatus = "error";
      error = msg;
      addSystemMessage(`Failed to connect: ${msg}`);
      updateAll();
    }
  };

  // Streaming batching (avoid repainting per-token)
  let streamingBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flushStreaming = () => {
    streamingContent = streamingBuffer;
    flushTimer = null;
    requestRender();
  };

  const send = (command: Command) => engine.send(command);

  const newSession = () => {
    messages = [];
    streamingContent = "";
    streamingBuffer = "";
    sessionStatus = "idle";
    const next = createId();
    sessionId = next;
    send({ type: "session.create", payload: { sessionId: next } });
    addSystemMessage("New session.");
  };

  const sendMessage = (content: string) => {
    if (!sessionId) {
      addSystemMessage("No session. Try ^R to reconnect.");
      return;
    }
    const userMessage: Message = { id: createId(), role: "user", content, timestamp: Date.now() };
    messages = [...messages, userMessage];
    send({ type: "session.send", payload: { sessionId, content } });
    requestRender();
  };

  const ensureEngineConnected = (): boolean => {
    if (connectionStatus !== "connected") {
      addSystemMessage("Not connected to engine.");
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
    addSystemMessage(ok ? "Copied." : "Copy failed (clipboard tool not found).");
  };

  const copySelection = async () => {
    const selected = getSelectionText();
    if (!selected.trim()) {
      addSystemMessage("Nothing selected.");
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
  };

  const startService = (name: ServiceName) => {
    if (!ensureEngineConnected()) return;
    addSystemMessage(`Starting service: ${name}`);
    send({ type: "service.start", payload: { name } });
    requestServiceStatus(name);
  };

  const stopService = (name: ServiceName) => {
    if (!ensureEngineConnected()) return;
    addSystemMessage(`Stopping service: ${name}`);
    send({ type: "service.stop", payload: { name } });
    requestServiceStatus(name);
  };

  const ensureKokomoRunning = async (): Promise<boolean> => {
    if (!ensureEngineConnected()) return false;
    const current = services["kokomo"];
    if (current?.status === "running") return true;
    addSystemMessage("[say] starting kokomo…");
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

    const helpText = [
      "Commands:",
      "  /help",
      "  /say <text>",
      "  /install list",
      "  /install kokomo|mlx [--yes]",
      "  /install vlm [--yes]",
      "  /install mlx-model <modelId> [--yes]",
      "  /copy last",
      "  /copy <text>",
      "  /service kokomo|mlx|vlm start|stop|status",
      "  /kokomo start|stop|status",
      "  /mlx start|stop|status",
      "  /vlm start|stop|status",
      "",
      "Tips:",
      "  /install runs local commands only when you pass --yes.",
      "  If /say fails, run: /install kokomo --yes",
    ].join("\n");

    if (!cmd || cmd === "help") {
      addSystemMessage(helpText);
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
            "  mlx-model  - prefetch an MLX model",
            "",
            "Examples:",
            "  /install kokomo --yes",
            "  /install mlx --yes",
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
        const code = await runInstaller(spec, argRest, (line) => {
          addSystemMessage(`[install:${spec.id}] ${line}`);
        }).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          addSystemMessage(`[install:${spec.id}] failed: ${msg}`);
          return 1;
        });

        addSystemMessage(code === 0 ? `[install:${spec.id}] done` : `[install:${spec.id}] exited with code ${code}`);
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

    if (cmd === "service" || cmd === "svc") {
      const nameRaw = parts[1] ?? "";
      const name = normalizeServiceName(nameRaw);
      const action = (parts[2] ?? "status").toLowerCase();
      if (!name) {
        addSystemMessage(`Unknown service "${nameRaw}". Try: kokomo|mlx`);
        return;
      }
      if (action === "start") return startService(name);
      if (action === "stop") return stopService(name);
      if (action === "status") {
        requestServiceStatus(name);
        addSystemMessage(`Requested status: ${name}`);
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
      addSystemMessage("Requested status: kokomo");
      return;
    }

    if (cmd === "mlx" || cmd === "llm") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") return startService("mlx");
      if (action === "stop") return stopService("mlx");
      requestServiceStatus("mlx");
      addSystemMessage("Requested status: mlx");
      return;
    }

    if (cmd === "vlm" || cmd === "vision") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") return startService("vlm");
      if (action === "stop") return stopService("vlm");
      requestServiceStatus("vlm");
      addSystemMessage("Requested status: vlm");
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

    // Quit
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      destroy();
      process.exit(0);
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
      void engine.connect().catch((err) => {
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
      case "assistant.token":
        streamingBuffer += event.token;
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
        streamingContent = "";
        break;
      case "service.status":
        services = { ...services, [event.service.name]: event.service };
        {
          const detail = event.service.detail ? ` — ${event.service.detail}` : "";
          const line = `[service] ${event.service.name}: ${event.service.status}${detail}`;
          if (lastServiceStatusLineByName[event.service.name] !== line) {
            lastServiceStatusLineByName = { ...lastServiceStatusLineByName, [event.service.name]: line };
            addSystemMessage(line);
          }
        }
        break;
      case "service.log":
        {
          const line = `${event.stream === "stderr" ? "!" : " "} ${event.line}`;
          const existing = serviceLogs[event.name] ?? [];
          const next = [...existing, line];
          serviceLogs = { ...serviceLogs, [event.name]: clampLines(next, 400) };
        }
        break;
      case "error":
        error = event.error;
        if (connectionStatus !== "connected") connectionStatus = "error";
        addSystemMessage(`Error: ${event.error}`);
        break;
    }
    updateAll();
  };

  engine.on("event", handleEngineEvent);
  engine.on("connected", () => {
    connectionStatus = "connected";
    error = null;
    updateAll();
  });
  engine.on("disconnected", () => {
    connectionStatus = "disconnected";
    updateAll();
  });

  renderer.start();
  applyScreenVisibility();
  requestRender();
}
