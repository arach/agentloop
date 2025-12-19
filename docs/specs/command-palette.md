# Spec: Command Palette & Discoverability (M1-A)

Status: drafting. Owner: @agent.

## Goal
Make commands/features discoverable and runnable without memorizing slash commands. Provide “what can I do now?” context.

## Scope (MVP)
- Palette invoke shortcut (e.g., `Ctrl+P` / `Cmd+P` in TUI) and command bar button.
- Searchable list of commands/actions:
  - Slash commands (/help, /install, /service, /runtime, /say, /commit, /copy, /install list).
  - Quick actions (copy last/selection/code/audio).
  - Service actions (start/stop/status for kokomo/mlx/vlm) respecting current selection.
  - Connection/runtime actions (^R reconnect/start backend).
- Context hints: show current connection status, active service, and “suggested next” when disconnected or services missing.
- Accepts freeform input; hitting Enter runs selected entry or the typed slash command.

## Out of Scope (MVP)
- Multi-step wizards inside the palette.
- Plugin-provided commands (supported in M2 after plugin loader).

## UX Notes
- Invoker: keybinding + small hint in footer/help.
- Filtering: fuzzy match on name + description; show badges (type: command/action/service).
- Result action: execute immediately and echo to chat/system messages; on errors, show the reason inline.
- Accessibility: keyboard-only (arrows/tab), mouse optional.

## Data / API
- TUI-local list of palette items assembled from:
  - Static command catalog.
  - Service actions derived from known services.
  - Quick actions list.
- No protocol changes for MVP; uses existing slash commands and TUI actions.

## Acceptance Criteria
- Palette opens reliably; can run /help, start a service, copy last message from palette.
- Suggests “Reconnect/start backend” when disconnected.
- Works without mouse; visible hint in UI.
