import {
  ASCIIFontRenderable,
  BoxRenderable,
  ScrollBoxRenderable,
  StyledText,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  TextareaRenderable,
  createCliRenderer,
  bold,
  dim,
  fg,
  t,
} from "@opentui/core";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CONFIG,
  SERVICE_BY_NAME,
  SERVICE_NAMES,
  SERVICE_PORTS,
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
import { chatterboxTtsToWavFile } from "./utils/chatterbox.js";
import { kokomoTtsLocalToWavFile, kokomoTtsToWavFile, tryPlayAudioFile } from "./utils/kokomo.js";
import { fetchLogoToCache } from "./utils/logos.js";
import { createLogger } from "./utils/logger.js";
import { shellTokenize } from "./utils/shellTokens.js";
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
      "  - TTS (chatterbox): /install chatterbox --yes  →  /service chatterbox start  →  /say hello",
      "  - LLM (mlx):    /install mlx --yes     →  /service mlx start     →  chat normally",
      "  - VLM (vlm):    /install vlm --yes     →  /service vlm start     →  drag/drop image paths into chat",
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
      "^S          services",
      "^L          logs",
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

  // Services sheet (overlay modal)
  const servicesOverlay = new BoxRenderable(renderer, {
    id: "servicesOverlay",
    position: "absolute",
    top: "12%",
    left: "12%",
    width: "76%",
    height: "70%",
    zIndex: 120,
    border: true,
    borderColor: theme.borderFocused,
    backgroundColor: theme.panelBg,
    padding: 2,
    flexDirection: "column",
    gap: 1,
    visible: false,
  });
  root.add(servicesOverlay);

  const servicesSheetHeader = new BoxRenderable(renderer, {
    id: "servicesSheetHeader",
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  });
  servicesOverlay.add(servicesSheetHeader);

  const servicesSheetTitle = new TextRenderable(renderer, {
    id: "servicesSheetTitle",
    fg: theme.fg,
    wrapMode: "none",
    selectable: false,
    content: "Services",
    height: 1,
  });
  servicesSheetHeader.add(servicesSheetTitle);

  const servicesSheetMeta = new TextRenderable(renderer, {
    id: "servicesSheetMeta",
    fg: theme.dim,
    wrapMode: "none",
    selectable: false,
    content: "Running + available services",
    height: 1,
  });
  servicesSheetHeader.add(servicesSheetMeta);

  const servicesSheetDivider = new TextRenderable(renderer, {
    id: "servicesSheetDivider",
    fg: theme.dim2,
    wrapMode: "none",
    selectable: false,
    content: "────────────────────────────────────────────────────────────────────────────",
    height: 1,
  });
  servicesOverlay.add(servicesSheetDivider);

  const servicesSheetScroll = new ScrollBoxRenderable(renderer, {
    id: "servicesSheetScroll",
    flexGrow: 1,
    scrollY: true,
    stickyScroll: false,
    viewportCulling: true,
    scrollbarOptions: { showArrows: false, trackOptions: { foregroundColor: theme.border, backgroundColor: theme.panelBg } },
  });
  servicesOverlay.add(servicesSheetScroll);

  const servicesSheetText = new TextRenderable(renderer, {
    id: "servicesSheetText",
    fg: theme.fg,
    selectable: true,
    wrapMode: "none",
    selectionBg: theme.selectionBg,
    selectionFg: theme.selectionFg,
    width: "100%",
  });
  servicesSheetScroll.add(servicesSheetText);

  const servicesSheetFooter = new TextRenderable(renderer, {
    id: "servicesSheetFooter",
    fg: theme.dim,
    wrapMode: "none",
    selectable: false,
    content: "Tab switch • ↑/↓ move • Enter status • s start • x stop • i install • Esc close",
    height: 1,
  });
  servicesOverlay.add(servicesSheetFooter);

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

  const defaultTtsService: ServiceName =
    (process.env.AGENTLOOP_TTS_PROVIDER ?? "").toLowerCase() === "chatterbox" ? "chatterbox" : "kokomo";
  let activeService: ServiceName = defaultTtsService;
  const serviceNameList = SERVICE_NAMES.join("|");
  const isServiceName = (value: string): value is ServiceName => SERVICE_NAMES.includes(value as ServiceName);
  const serviceKindLabel = (kind: "tts" | "llm" | "vlm") => (kind === "tts" ? "TTS" : kind === "llm" ? "LLM" : "VLM");
  const serviceTabOptions = SERVICE_NAMES.map((name) => {
    const def = SERVICE_BY_NAME[name];
    return { name: def.name, description: def.title, value: def.name };
  });
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
    options: serviceTabOptions,
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
    options: SERVICE_NAMES.map((name) => ({
      name,
      description: `${name} logs`,
      value: name,
    })),
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
      ...SERVICE_NAMES.map((name) => {
        const def = SERVICE_BY_NAME[name];
        return {
          name: `install ${def.name}`,
          description: `Install ${serviceKindLabel(def.kind)}`,
          value: def.installCommand,
        };
      }),
      ...SERVICE_NAMES.map((name) => {
        const def = SERVICE_BY_NAME[name];
        return {
          name: `start ${def.name}`,
          description: `Start ${serviceKindLabel(def.kind)}`,
          value: def.startCommand,
        };
      }),
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
    content: ["/say <text>", "/services", `/service ${serviceNameList} start|stop|status`, "/install list", "/help"].join("\n"),
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

  const statusBar = new BoxRenderable(renderer, {
    id: "statusBar",
    width: "100%",
    height: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: 2,
    paddingRight: 2,
  });
  footer.add(statusBar);

  const statusLeft = new TextRenderable(renderer, {
    id: "statusLeft",
    fg: theme.dim,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  const statusRight = new TextRenderable(renderer, {
    id: "statusRight",
    fg: theme.dim2,
    wrapMode: "none",
    selectable: false,
    height: 1,
  });
  statusBar.add(statusLeft);
  statusBar.add(statusRight);

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
  let activeLogService: string = defaultTtsService;
  let lastLogTabsKey = "";
  let servicesTabsSynced = false;
  let serviceSelectionAnnounceEnabled = false;
  const recentServiceFeed: string[] = [];
  let lastInstallCheckAt = 0;
  const makeServiceRecord = <T,>(initial: T): Record<ServiceName, T> => {
    const record = {} as Record<ServiceName, T>;
    for (const name of SERVICE_NAMES) {
      record[name] = initial;
    }
    return record;
  };
  let installState: Record<ServiceName, boolean> = makeServiceRecord(false);
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
  let showDetails = true;
  const conversationStyleEnv = (process.env.AGENTLOOP_CONVERSATION_STYLE ?? "").toLowerCase();
  let conversationStyle: "minimal" | "powerline" =
    conversationStyleEnv === "powerline" ? "powerline" : "minimal";
  let servicesSheetOpen = false;
  let servicesSheetSection: "running" | "available" = "running";
  let servicesSheetSelection = { running: 0, available: 0 };
  let servicesSheetRunning: ServiceName[] = [];
  let servicesSheetAvailable: ServiceName[] = [];
  let servicesSheetNote: string | null = null;
  let servicesSheetNoteUntil = 0;
  const portByService: Record<ServiceName, number> = SERVICE_PORTS;
  let managedEngineLogLines: string[] = [];
  const engineLogName = "engine";

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

  const getSelectionText = () => {
    const selection = renderer.getSelection?.();
    if (selection?.getSelectedText) {
      return selection.getSelectedText();
    }
    return renderer.getSelectionContainer?.()?.getSelectedText?.() ?? "";
  };

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
    headerRight.content = showDetails
      ? `${conn}${err} · ${sStatus} · ${agentLabel} · ws://${engineHost}:${enginePort}`
      : `${conn}${err} · ${sStatus}`;
  };

  const updateConversation = () => {
    conversationText.content = renderConversation({
      theme,
      messages,
      sessionStatus,
      streamingContent,
      style: conversationStyle,
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
        const next: Record<ServiceName, boolean> = { ...installState };
        for (const name of SERVICE_NAMES) {
          const rel = SERVICE_BY_NAME[name].installCheckPath;
          if (!rel) {
            next[name] = false;
            continue;
          }
          try {
            next[name] = await Bun.file(path.join(root, rel)).exists();
          } catch {
            next[name] = false;
          }
        }
        installState = next;
        updateServicesSheet();
        requestRender();
      })();
    }

    servicesMeta.content = `active=${activeService} · actions: start/stop/status · ports: ${SERVICE_NAMES.map(
      (name) => `${SERVICE_BY_NAME[name].short}${portByService[name]}`
    ).join(" ")}`;
    const known: ServiceName[] = [...SERVICE_NAMES];

    const statusBadge = (status?: ServiceState["status"]) => {
      if (status === "running") return "RUN";
      if (status === "starting") return "START";
      if (status === "stopping") return "STOP";
      if (status === "error") return "ERR";
      if (status === "stopped") return "OFF";
      return "UNK";
    };
    const statusColor = (status?: ServiceState["status"]) => {
      if (status === "running") return theme.success;
      if (status === "starting") return theme.warning;
      if (status === "stopping") return theme.warning;
      if (status === "error") return theme.danger;
      if (status === "stopped") return theme.dim;
      return theme.muted;
    };
    const nameWidth = Math.max(7, ...known.map((name) => name.length + (name === activeService ? 1 : 0)));
    const instWidth = 4;
    const statusWidth = 7;
    const portWidth = 4;
    const headerRow = `  ${"svc*".padEnd(nameWidth, " ")} ${"inst".padEnd(instWidth, " ")} ${"status".padEnd(
      statusWidth,
      " "
    )} ${"port".padEnd(portWidth, " ")} detail`;
    const separatorRow = `  ${"-".repeat(nameWidth)} ${"-".repeat(instWidth)} ${"-".repeat(statusWidth)} ${"-".repeat(
      portWidth
    )} ------------------------------------------`;

    const chunks: StyledText[] = [];
    const pushLine = (line: StyledText) => {
      chunks.push(line, t`\n`);
    };

    pushLine(fg(theme.dim2)(headerRow));
    pushLine(fg(theme.dim2)(separatorRow));
    for (const name of known) {
      const svc = services[name];
      const label = (name + (name === activeService ? "*" : "")).padEnd(nameWidth, " ");
      const labelStyled = name === activeService ? bold(label) : label;
      const inst = (installState[name] ? "yes" : "no").padEnd(instWidth, " ");
      const status = statusBadge(svc?.status).padEnd(statusWidth, " ");
      const port = String(portByService[name]).padEnd(portWidth, " ");
      const detail = (svc?.detail ?? "").trim();
      const tail = svc?.lastError
        ? `err: ${svc.lastError}`
        : svc?.lastExitCode != null
          ? `exit: ${svc.lastExitCode}`
          : "";
      const summary = SERVICE_BY_NAME[name]?.summary ?? "";
      const info = (detail || tail || summary || "—").replace(/\s+/g, " ").slice(0, 58);
      pushLine(
        t`  ${fg(theme.fg)(labelStyled)} ${fg(theme.muted)(inst)} ${fg(statusColor(svc?.status))(
          status
        )} ${fg(theme.muted)(port)} ${fg(theme.fg)(info)}`
      );
    }

    const feed = recentServiceFeed.slice(-3);
    if (feed.length) {
      pushLine(t``);
      pushLine(fg(theme.dim)("Recent:"));
      for (const line of feed) pushLine(fg(theme.dim2)(line));
    }
    servicesText.content = new StyledText(chunks.flatMap((c) => c.chunks));

    if (!servicesTabsSynced) {
      // Ensure service tab selection starts on the default service.
      const idx = known.indexOf(activeService);
      serviceTabs.setSelectedIndex(idx >= 0 ? idx : 0);
      servicesTabsSynced = true;
      serviceSelectionAnnounceEnabled = true;
    }

    // Per-service log tabs
    const serviceNames = Array.from(
      new Set<string>([
        ...Object.keys(services),
        ...Object.keys(serviceLogs),
        ...SERVICE_NAMES,
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

  const ensureServicesSheetSelectionVisible = (line: number | null) => {
    if (!servicesSheetOpen || line == null) return;
    const viewportHeight = servicesSheetScroll.viewport.height || servicesSheetScroll.height || 0;
    if (viewportHeight <= 0) return;
    const top = servicesSheetScroll.scrollTop;
    const bottom = top + viewportHeight - 1;
    if (line < top) servicesSheetScroll.scrollTop = line;
    if (line > bottom) servicesSheetScroll.scrollTop = Math.max(0, line - viewportHeight + 1);
  };

  const updateServicesSheet = () => {
    if (!servicesSheetOpen) return;
    if (servicesSheetNote && Date.now() > servicesSheetNoteUntil) {
      servicesSheetNote = null;
    }
    const known: ServiceName[] = [...SERVICE_NAMES];
    const running = known.filter((name) => services[name]?.status === "running");
    const available = known.filter((name) => services[name]?.status !== "running");
    const metaBase = `Running ${running.length} · Available ${available.length} · Active ${activeService}`;
    servicesSheetMeta.content = servicesSheetNote ? `${metaBase} · ${servicesSheetNote}` : metaBase;
    servicesSheetRunning = running;
    servicesSheetAvailable = available;
    const clampIndex = (idx: number, len: number) => (len <= 0 ? 0 : Math.max(0, Math.min(idx, len - 1)));
    servicesSheetSelection = {
      running: clampIndex(servicesSheetSelection.running, running.length),
      available: clampIndex(servicesSheetSelection.available, available.length),
    };
    if (servicesSheetSection === "running" && running.length === 0 && available.length > 0) {
      servicesSheetSection = "available";
    } else if (servicesSheetSection === "available" && available.length === 0 && running.length > 0) {
      servicesSheetSection = "running";
    }
    const chunks: StyledText[] = [];
    const pushLine = (line: StyledText) => {
      chunks.push(line, t`\n`);
    };
    let lineIndex = 0;
    let selectedLine: number | null = null;

    const nameWidth = Math.max(7, ...known.map((name) => name.length + (name === activeService ? 1 : 0)));
    const instWidth = 4;
    const statusWidth = 7;
    const portWidth = 4;
    const headerRow = `  ${"svc*".padEnd(nameWidth, " ")} ${"inst".padEnd(instWidth, " ")} ${"status".padEnd(
      statusWidth,
      " "
    )} ${"port".padEnd(portWidth, " ")} detail`;
    const separatorRow = `  ${"-".repeat(nameWidth)} ${"-".repeat(instWidth)} ${"-".repeat(statusWidth)} ${"-".repeat(
      portWidth
    )} ------------------------------------------`;
    const statusBadge = (status?: ServiceState["status"]) => {
      if (status === "running") return "RUN";
      if (status === "starting") return "START";
      if (status === "stopping") return "STOP";
      if (status === "error") return "ERR";
      if (status === "stopped") return "OFF";
      return "UNK";
    };
    const statusColor = (status?: ServiceState["status"]) => {
      if (status === "running") return theme.success;
      if (status === "starting") return theme.warning;
      if (status === "stopping") return theme.warning;
      if (status === "error") return theme.danger;
      if (status === "stopped") return theme.dim;
      return theme.muted;
    };

    pushLine(bold(`Running${servicesSheetSection === "running" ? " •" : ""}`));
    lineIndex += 1;
    if (running.length === 0) {
      pushLine(fg(theme.dim)("(none)"));
      lineIndex += 1;
    } else {
      pushLine(fg(theme.dim2)(headerRow));
      lineIndex += 1;
      pushLine(fg(theme.dim2)(separatorRow));
      lineIndex += 1;
      running.forEach((name, idx) => {
        const svc = services[name];
        const selected = servicesSheetSection === "running" && idx === servicesSheetSelection.running;
        const prefix = selected ? "›" : " ";
        const label = (name + (name === activeService ? "*" : "")).padEnd(nameWidth, " ");
        const inst = (installState[name] ? "yes" : "no").padEnd(instWidth, " ");
        const status = statusBadge(svc?.status).padEnd(statusWidth, " ");
        const port = String(portByService[name]).padEnd(portWidth, " ");
        const detail = (svc?.detail ?? "").trim();
        const tail = svc?.lastError
          ? `err: ${svc.lastError}`
          : svc?.lastExitCode != null
            ? `exit: ${svc.lastExitCode}`
            : "";
        const summary = SERVICE_BY_NAME[name]?.summary ?? "";
        const info = (detail || tail || summary || "—").replace(/\s+/g, " ").slice(0, 58);
        const labelStyled = name === activeService ? bold(label) : label;
        pushLine(
          t`${fg(theme.dim2)(prefix)} ${fg(theme.fg)(labelStyled)} ${fg(theme.muted)(inst)} ${fg(
            statusColor(svc?.status)
          )(status)} ${fg(theme.muted)(port)} ${fg(theme.fg)(info)}`
        );
        if (selected) selectedLine = lineIndex;
        lineIndex += 1;
      });
    }
    pushLine(t``);
    lineIndex += 1;
    pushLine(bold(`Available${servicesSheetSection === "available" ? " •" : ""}`));
    lineIndex += 1;
    if (available.length === 0) {
      pushLine(fg(theme.dim)("(none)"));
      lineIndex += 1;
    } else {
      pushLine(fg(theme.dim2)(headerRow));
      lineIndex += 1;
      pushLine(fg(theme.dim2)(separatorRow));
      lineIndex += 1;
      available.forEach((name, idx) => {
        const svc = services[name];
        const inst = (installState[name] ? "yes" : "no").padEnd(instWidth, " ");
        const status = statusBadge(svc?.status ?? "stopped").padEnd(statusWidth, " ");
        const detail = svc?.detail ?? (svc?.lastError ? `err: ${svc.lastError}` : "");
        const summary = SERVICE_BY_NAME[name]?.summary ?? "";
        const info = (detail || summary || "—").replace(/\s+/g, " ").slice(0, 58);
        const selected = servicesSheetSection === "available" && idx === servicesSheetSelection.available;
        const prefix = selected ? "›" : " ";
        const label = (name + (name === activeService ? "*" : "")).padEnd(nameWidth, " ");
        const labelStyled = name === activeService ? bold(label) : label;
        const port = String(portByService[name]).padEnd(portWidth, " ");
        pushLine(
          t`${fg(theme.dim2)(prefix)} ${fg(theme.fg)(labelStyled)} ${fg(theme.muted)(inst)} ${fg(
            statusColor(svc?.status)
          )(status)} ${fg(theme.muted)(port)} ${fg(theme.fg)(info)}`
        );
        if (selected) selectedLine = lineIndex;
        lineIndex += 1;
      });
    }

    servicesSheetText.content = new StyledText(chunks.flatMap((c) => c.chunks));
    ensureServicesSheetSelectionVisible(selectedLine);
  };

  const moveServicesSheetSelection = (delta: number) => {
    const currentItems = servicesSheetSection === "running" ? servicesSheetRunning : servicesSheetAvailable;
    if (currentItems.length === 0) {
      const otherSection = servicesSheetSection === "running" ? "available" : "running";
      const otherItems = otherSection === "running" ? servicesSheetRunning : servicesSheetAvailable;
      if (otherItems.length === 0) return;
      servicesSheetSection = otherSection;
    }

    const items = servicesSheetSection === "running" ? servicesSheetRunning : servicesSheetAvailable;
    if (items.length === 0) return;
    const key = servicesSheetSection;
    const next = Math.max(0, Math.min(servicesSheetSelection[key] + delta, items.length - 1));
    if (next === servicesSheetSelection[key]) return;
    servicesSheetSelection = { ...servicesSheetSelection, [key]: next };
    updateServicesSheet();
    requestRender();
  };

  const toggleServicesSheetSection = () => {
    const nextSection = servicesSheetSection === "running" ? "available" : "running";
    const nextItems = nextSection === "running" ? servicesSheetRunning : servicesSheetAvailable;
    if (nextItems.length === 0) return;
    servicesSheetSection = nextSection;
    updateServicesSheet();
    requestRender();
  };

  const getServicesSheetSelectedService = (): ServiceName | null => {
    const items = servicesSheetSection === "running" ? servicesSheetRunning : servicesSheetAvailable;
    if (items.length === 0) return null;
    const idx = servicesSheetSection === "running" ? servicesSheetSelection.running : servicesSheetSelection.available;
    return items[idx] ?? null;
  };

  const updateHelp = () => {
    const conn =
      connectionStatus === "connected"
        ? "connected"
        : connectionStatus === "connecting"
          ? "connecting"
          : connectionStatus === "error"
            ? "error"
            : "disconnected";
    const agentLabel = routingMode === "pinned" ? `agent ${activeAgentName ?? "(unset)"}` : "agent auto";
    const baseRight = "^D details · ^S services · ^L logs · /help";
    const hasToast = toast && Date.now() < toastUntil;

    statusLeft.content = `${conn} · ${sessionStatus} · ${agentLabel}`;
    statusRight.content = hasToast ? String(toast) : baseRight;

    if (!hasToast) toast = null;
  };

  const updateAll = () => {
    updateHeader();
    updateConversation();
    updateInspector();
    updateSidebar();
    updateServicesSheet();
    updateHelp();
    composerHeader.content =
      sessionStatus === "thinking" || sessionStatus === "streaming" || sessionStatus === "tool_use"
        ? "You (waiting…) "
        : "You";
  };

  updateAll();

  const applyScreenVisibility = () => {
    const isSplash = screen === "splash";
    const detailsVisible = !isSplash && showDetails;
    splashOverlay.visible = isSplash;
    header.visible = detailsVisible;
    mainRow.visible = !isSplash;
    footer.visible = !isSplash;
    footer.height = detailsVisible ? 6 : 5;
    statusBar.visible = detailsVisible;
    sidebar.visible = detailsVisible;
    servicesSection.visible = detailsVisible;
    sidebarScroll.visible = detailsVisible;
    logsSection.visible = detailsVisible;
    logsServiceTabs.visible = detailsVisible && !logsCollapsed;
    logsScroll.visible = detailsVisible && !logsCollapsed;
    inspectorSection.visible = detailsVisible;
    inspectorScroll.visible = detailsVisible;
    actionsSection.visible = detailsVisible;
    actionTabs.visible = detailsVisible;
    presetsSection.visible = detailsVisible;
    presetsTabs.visible = detailsVisible && !presetsCollapsed;
    commandsSection.visible = detailsVisible;
    aboutOverlay.visible = aboutOpen && !isSplash;
    servicesOverlay.visible = servicesSheetOpen && !isSplash;
  };

  const toggleLogsVisibility = () => {
    if (!showDetails) showDetails = true;
    logsCollapsed = !logsCollapsed;
    if (!logsCollapsed && connectionStatus === "error") {
      activeLogService = engineLogName;
    }
    applyScreenVisibility();
    updateAll();
    setToast(logsCollapsed ? "logs: hidden" : "logs: visible");
    if (!logsCollapsed) {
      renderer.focusRenderable(logsScroll);
      logsScroll.focus();
    }
    requestRender();
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
    if (aboutOpen) servicesSheetOpen = false;
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

  const setServicesSheetOpen = (next: boolean) => {
    if (next) showDetails = true;
    servicesSheetOpen = next;
    if (servicesSheetOpen) aboutOpen = false;
    updateServicesSheet();
    applyScreenVisibility();
    if (servicesSheetOpen) {
      renderer.focusRenderable(servicesSheetScroll);
      servicesSheetScroll.focus();
      setToast("services: open");
    } else if (screen === "main") {
      renderer.focusRenderable(textarea);
      textarea.focus();
      setToast("services: closed");
    }
    requestRender();
  };

  const setServicesSheetNote = (note: string, ms = 2200) => {
    servicesSheetNote = note;
    servicesSheetNoteUntil = Date.now() + ms;
    updateServicesSheet();
    requestRender();
    setTimeout(() => {
      if (Date.now() < servicesSheetNoteUntil) return;
      servicesSheetNote = null;
      updateServicesSheet();
      requestRender();
    }, ms);
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
	        engine.send({ type: "service.status", payload: { name: "chatterbox" } } as Command);
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
      attachManagedEngineLogs(managedEngineProc);
      attachManagedEngineExit(managedEngineProc);
      try {
        (managedEngineProc as any)?.unref?.();
      } catch {
        // ignore
      }

      const nextState = await waitForEngineStateFile({ stateFile: enginePaths.stateFile });
      if (!nextState) {
        connectionStatus = "error";
        error = "Engine did not become ready";
        const tail = managedEngineLogLines.slice(-6).join("\n");
        const detail = tail ? `\n\nLast engine output:\n${tail}` : "";
        addSystemMessage(`[runtime] failed to start (no state file written): ${enginePaths.stateFile}${detail}`);
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

  const appendManagedEngineLog = (line: string, stream: "stdout" | "stderr") => {
    const entry = `[engine ${stream}] ${line}`;
    managedEngineLogLines = [...managedEngineLogLines, entry].slice(-200);
    const existing = serviceLogs[engineLogName] ?? [];
    serviceLogs = { ...serviceLogs, [engineLogName]: clampLines([...existing, entry], 400) };
    if (stream === "stderr") log.error(entry);
    else log.info(entry);
  };

  const attachManagedEngineLogs = (proc: ReturnType<typeof spawnManagedEngine> | null) => {
    if (!proc?.stdout && !proc?.stderr) return;
    const pump = async (stream: any, label: "stdout" | "stderr") => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          appendManagedEngineLog(line, label);
        }
      }
      if (buffer.trim()) appendManagedEngineLog(buffer.trim(), label);
    };
    void pump(proc.stdout as any, "stdout");
    void pump(proc.stderr as any, "stderr");
  };

  const attachManagedEngineExit = (proc: ReturnType<typeof spawnManagedEngine> | null) => {
    if (!proc) return;
    const exited = (proc as any).exited as Promise<number> | undefined;
    if (!exited) return;
    void exited
      .then((code) => {
        const msg = `[runtime] managed backend exited (code ${code})`;
        log.error(msg);
        addSystemMessage(msg);
        if (connectionStatus === "connecting") {
          connectionStatus = "error";
          error = `Engine exited (${code})`;
          updateAll();
        }
      })
      .catch(() => {});
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

  const sendMessage = (content: string, opts?: { images?: string[]; displayContent?: string }) => {
    if (!ensureEngineConnected({ quiet: true })) {
      addSystemMessage("Tip: press ^R to reconnect/start backend.");
      return;
    }
    const images = opts?.images ?? [];
    const displayContent = opts?.displayContent ?? content;
    log.data("user message", { content, length: content.length, images });
    pendingPerf = { startedAt: Date.now(), contentLength: content.length, tokens: 0 };
    const userMessage: Message = { id: createId(), role: "user", content: displayContent, timestamp: Date.now() };
    messages = [...messages, userMessage];
    send({ type: "session.send", payload: { sessionId, content, images: images.length ? images : undefined } });
    requestRender();
  };

  const ensureEngineConnected = (opts?: { quiet?: boolean }): boolean => {
    if (connectionStatus !== "connected") {
      if (!opts?.quiet) addSystemMessage("Not connected to engine.");
      return false;
    }
    return true;
  };

  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
  const resolveImageToken = (token: string): { absPath: string; displayPath: string } | null => {
    if (!token) return null;
    let cleaned = token.trim();
    cleaned = cleaned.replace(/[),.;]+$/, "");
    if (!cleaned) return null;
    if (cleaned.startsWith("file://")) cleaned = cleaned.slice("file://".length);
    if (cleaned.startsWith("~/")) {
      const home = process.env.HOME ?? "";
      cleaned = home ? path.join(home, cleaned.slice(2)) : cleaned;
    }
    const ext = path.extname(cleaned).toLowerCase();
    if (!imageExtensions.has(ext)) return null;
    const absPath = path.isAbsolute(cleaned) ? cleaned : path.resolve(enginePaths.repoRoot, cleaned);
    try {
      if (!existsSync(absPath)) return null;
      if (!statSync(absPath).isFile()) return null;
    } catch {
      return null;
    }
    const rel = path.relative(enginePaths.repoRoot, absPath);
    const displayPath = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : absPath;
    return { absPath, displayPath };
  };
  const extractImageAttachments = (raw: string): { text: string; images: string[]; displayLines: string[] } => {
    const tokens = shellTokenize(raw);
    if (!tokens.length) return { text: raw.trim(), images: [], displayLines: [] };
    const images: string[] = [];
    const displayLines: string[] = [];
    const ranges: Array<[number, number]> = [];
    const seen = new Set<string>();
    for (const token of tokens) {
      const match = resolveImageToken(token.value);
      if (!match) continue;
      if (!seen.has(match.absPath)) {
        seen.add(match.absPath);
        images.push(match.absPath);
        displayLines.push(`[image] ${match.displayPath}`);
      }
      ranges.push([token.start, token.end]);
    }
    if (!images.length) return { text: raw.trim(), images: [], displayLines: [] };
    const sorted = ranges.sort((a, b) => a[0] - b[0]);
    let merged = "";
    let cursor = 0;
    for (const [start, end] of sorted) {
      if (start < cursor) continue;
      merged += raw.slice(cursor, start);
      cursor = end;
    }
    merged += raw.slice(cursor);
    const text = merged.replace(/[ \t]{2,}/g, " ").trim();
    return { text, images, displayLines };
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
      setToast(`copy: nothing (${label})`);
      return;
    }
    setToast(`copy: ${label}…`);
    const ok = await tryCopyToClipboard(trimmed);
    setToast(ok ? "copied" : "copy failed");
    if (!ok) log.error(`[copy] failed (${label})`);
  };

  const copySelection = async () => {
    const selected = getSelectionText();
    if (!selected.trim()) {
      setToast("copy: nothing selected");
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
      chatter: "chatterbox",
      cb: "chatterbox",
      tts: "kokomo",
      m: "mlx",
      llm: "mlx",
      local: "mlx",
      vision: "vlm",
      image: "vlm",
    };
    if (aliases[n]) return aliases[n];
    if (n.startsWith("koko")) return "kokomo";
    if (n.startsWith("chat") || n.startsWith("chatter")) return "chatterbox";
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

  const getTtsProvider = (): "kokomo" | "chatterbox" => {
    const raw = (process.env.AGENTLOOP_TTS_PROVIDER ?? "kokomo").toLowerCase();
    return raw === "chatterbox" ? "chatterbox" : "kokomo";
  };

  const ensureTtsRunning = async (name: "kokomo" | "chatterbox"): Promise<boolean> => {
    if (!ensureEngineConnected()) return false;
    const current = services[name];
    if (current?.status === "running") return true;
    addSystemMessage(`[say] starting ${name}…`, { silent: true });
    send({ type: "service.start", payload: { name } });

    const start = Date.now();
    while (Date.now() - start < 20_000) {
      const s = services[name];
      if (s?.status === "running") return true;
      if (s?.status === "error") return false;
      if (s?.status === "stopped" && s.lastError) return false;
      requestServiceStatus(name);
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
        "  /services [open|close]",
        "  /install list",
        "  /install kokomo|chatterbox|mlx [--yes]",
        "  /install vlm [--yes]",
        "  /install mlx-model <modelId> [--yes]",
        "  /copy last",
        "  /copy <text>",
        "  /commit <message> [--yes] [--all] [--amend]",
        `  /service ${serviceNameList} start|stop|status`,
        "  /runtime start|stop|restart|status   (managed backend)",
        "  /kokomo start|stop|status",
        "  /chatterbox start|stop|status",
        "  /mlx start|stop|status",
        "  /vlm start|stop|status",
        "  /logo <domain>  (download logo PNG to cache)",
        "",
        "Tips:",
        "  /install runs local commands only when you pass --yes.",
        "  /commit will not run unless you pass --yes.",
        "  Drag a PNG/JPG/WebP into the input to attach it (requires VLM).",
        "  Theme: set AGENTLOOP_THEME=forge|forge-core|noir before launch.",
        "  Chat style: set AGENTLOOP_CONVERSATION_STYLE=powerline.",
        "  Ctrl+S opens the services sheet.",
        "  Ctrl+L toggles logs.",
        "  Fast mode: AGENTLOOP_MLX_MODEL_QUICK + AGENTLOOP_MLX_MAX_TOKENS_QUICK.",
        "  Quick server: set AGENTLOOP_MLX_URL_QUICK to target a separate MLX instance.",
        "  Disable follow-up: AGENTLOOP_QUICK_FOLLOWUP=0.",
        "  Gated models: set AGENTLOOP_HF_TOKEN before starting MLX.",
        "  Local env file: .agentloop/env (or AGENTLOOP_ENV_FILE).",
        "  If /say fails, run: /install kokomo --yes (or /install chatterbox --yes)",
        "  If chat says no LLM, run: /install mlx --yes  →  /service mlx start",
      ].join("\n");

    if (!cmd || cmd === "help") {
      addSystemMessage(helpText);
      return;
    }

    if (cmd === "services") {
      const sub = (parts[1] ?? "toggle").toLowerCase();
      if (sub === "open" || sub === "show" || sub === "toggle") {
        const next = sub === "toggle" ? !servicesSheetOpen : true;
        setServicesSheetOpen(next);
        return;
      }
      if (sub === "close" || sub === "hide") {
        setServicesSheetOpen(false);
        return;
      }
      addSystemMessage("Usage: /services [open|close]");
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

    if (cmd === "theme") {
      const sub = (parts[1] ?? "show").toLowerCase();
      if (sub === "show") {
        addSystemMessage(`Conversation theme: ${conversationStyle}`);
        return;
      }
      if (sub === "conversation" || sub === "chat") {
        const style = (parts[2] ?? "").toLowerCase();
        if (style !== "minimal" && style !== "powerline") {
          addSystemMessage("Usage: /theme conversation minimal|powerline");
          return;
        }
        conversationStyle = style;
        setToast(`theme: ${style}`);
        requestRender();
        return;
      }
      addSystemMessage("Usage: /theme show | /theme conversation minimal|powerline");
      return;
    }

    if (cmd === "install") {
      const sub = (parts[1] ?? "").toLowerCase();
      const yes = parts.includes("--yes") || parts.includes("-y");
      const argRest = parts.slice(2).filter((p) => p !== "--yes" && p !== "-y");

      const showList = () => {
        const serviceLines = SERVICE_NAMES.map((name) => {
          const def = SERVICE_BY_NAME[name];
          return `  ${def.name.padEnd(10, " ")} - ${def.summary}`;
        });
        addSystemMessage(
          [
            "Install targets:",
            ...serviceLines,
            "  mlx-model  - prefetch an MLX model",
            "",
            "Examples:",
            "  /install kokomo --yes",
            "  /install chatterbox --yes",
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
        addSystemMessage(`Usage: /service ${serviceNameList} start|stop|status`);
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

    if (cmd === "chatterbox" || cmd === "cb") {
      const action = (parts[1] ?? "status").toLowerCase();
      if (action === "start") return startService("chatterbox");
      if (action === "stop") return stopService("chatterbox");
      requestServiceStatus("chatterbox");
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

          const provider = getTtsProvider();
          if (provider === "kokomo") {
            const ready = await ensureTtsRunning("kokomo");
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
          } else {
            const ready = await ensureTtsRunning("chatterbox");
            if (!ready) {
              const state = services["chatterbox"];
              throw new Error(state?.lastError ?? "chatterbox not running");
            }
            addSystemMessage("[say] calling chatterbox /tts…");
            ({ filePath, bytes } = await chatterboxTtsToWavFile(text));
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
          if (msg.toLowerCase().includes("kokomo")) {
            addSystemMessage("Tip: /install kokomo --yes");
          } else if (msg.toLowerCase().includes("chatterbox")) {
            addSystemMessage("Tip: /install chatterbox --yes");
          }
        }
      })();
      return;
    }

    addSystemMessage(`Unknown command "/${cmd}". Try /help`);
    log.error(`unknown slash command: /${cmd}`);
  };

  const submitInput = () => {
    const raw = textarea.plainText.trimEnd();
    textarea.setText("");
    textarea.cursorOffset = 0;
    historyIndex = null;
    if (!raw.trim()) return;

    // History should store what the user typed (commands + messages).
    history.push(raw);
    if (history.length > 200) history.splice(0, history.length - 200);

    if (raw.trimStart().startsWith("/")) {
      runSlashCommand(raw);
      return;
    }

    if (sessionStatus === "thinking" || sessionStatus === "streaming") {
      addSystemMessage("Agent is responding; please wait (or /help).");
      return;
    }

    const { text, images, displayLines } = extractImageAttachments(raw);
    if (!text && images.length === 0) return;
    const displayContent = [text, ...displayLines].filter(Boolean).join("\n");
    sendMessage(text, { images, displayContent });
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
    if (isServiceName(name)) {
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

    // Services sheet
    if (servicesSheetOpen) {
      if (key.name === "escape") {
        key.preventDefault();
        setServicesSheetOpen(false);
      }
      if (key.name === "tab") {
        key.preventDefault();
        toggleServicesSheetSection();
      }
      if (key.name === "up") {
        key.preventDefault();
        moveServicesSheetSelection(-1);
      }
      if (key.name === "down") {
        key.preventDefault();
        moveServicesSheetSelection(1);
      }
      if (key.name === "return" || key.name === "linefeed" || key.name === "enter") {
        key.preventDefault();
        const selected = getServicesSheetSelectedService();
        if (!selected) return;
        activeService = selected;
        activeLogService = selected;
        logsCollapsed = false;
        logsServiceTabs.visible = true;
        logsScroll.visible = true;
        requestServiceStatus(selected);
        updateSidebar();
        setServicesSheetNote(`status requested: ${selected}`);
      }
      if (key.name === "s") {
        key.preventDefault();
        const selected = getServicesSheetSelectedService();
        if (!selected) return;
        if (!installState[selected]) {
          addSystemMessage(`Service "${selected}" not installed. Run: /install ${selected} --yes`);
          return;
        }
        startService(selected);
        updateServicesSheet();
      }
      if (key.name === "x") {
        key.preventDefault();
        const selected = getServicesSheetSelectedService();
        if (!selected) return;
        stopService(selected);
        updateServicesSheet();
      }
      if (key.name === "i") {
        key.preventDefault();
        const selected = getServicesSheetSelectedService();
        if (!selected) return;
        if (installState[selected]) {
          setToast(`service: ${selected} already installed`);
          return;
        }
        runSlashCommand(`/install ${selected} --yes`);
      }
      return;
    }

    // Copy selection (conversation/sidebar/composer)
    if ((key.ctrl || key.meta || key.super) && key.name === "c") {
      const selected = getSelectionText().trimEnd();
      if (selected.trim()) {
        key.preventDefault();
        void copyText(selected, "selection");
        return;
      }
    }

    // Toggle details (header + footer help)
    if (key.ctrl && key.name === "d") {
      key.preventDefault();
      showDetails = !showDetails;
      setToast(showDetails ? "details: on" : "details: off");
      applyScreenVisibility();
      updateAll();
      requestRender();
      return;
    }

    // Toggle logs
    if (key.ctrl && key.name === "l") {
      key.preventDefault();
      toggleLogsVisibility();
      return;
    }

    // Services sheet
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      setServicesSheetOpen(!servicesSheetOpen);
      return;
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
      case "perf.metric":
        log.data("perf.metric", event);
        if ((event.name === "llm.total" || event.name === "agent.total") && (!toast || Date.now() > toastUntil)) {
          const label = event.name.replace(".", " ");
          setToast(`perf ${label}: ${Math.round(event.durationMs)}ms`);
        }
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
