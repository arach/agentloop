# Spec: Xcode Project Watcher (M4)

Status: planned (last ticket in roadmap). Target milestone: M4 “Companion & Watchers”.

## Goal
Alert when a file is created/moved into a watched folder but is not referenced in the Xcode project (`.xcodeproj`). Start with alert-only; add/modify project in V1 once the flow is proven safe.

## User Story (MVP)
- “I add a file under a watched folder. If it’s not in the project, tell me immediately and show next steps.”

## Scope (MVP)
- Watch one or more directories (recursive).
- Parse/scan `<Project>.xcodeproj/project.pbxproj` to build the set of referenced file paths.
- On create/move:
  - If missing from project references → emit alert.
  - Alert includes: file path (relative), project name, reason (“not in project”), suggested next actions.
- Actions (non-destructive):
  - Copy file path
  - Reveal in Finder
  - Open project in Xcode
- Manual commands: add/list/remove watchers; manual rescan.
- Safety: no project writes in MVP.

## Out of Scope (V1+)
- Adding files to the project (requires pbxproj edit) — design separately.
- Target/group inference beyond simple guesses.
- Workspace-level dependency checks (handled later if needed).

## Interfaces (proposed)
- Commands:
  - `watcher.add { projectPath, watchDirs[] }`
  - `watcher.remove { id }`
  - `watcher.list`
  - `watcher.scan { id }`
- Events:
  - `watcher.status { id, project, state: watching|paused|error, detail? }`
  - `watcher.alert { id, project, path, reason, suggestedActions[] }`

## Implementation Notes
- Detection: start with “is normalized relative path present in pbxproj file references?”
- Watching: `fs.watch` + periodic rescan fallback; switch to a robust watcher if needed.
- Parsing: string scan is OK for MVP read-only; move to a proper pbxproj parser before any writes.
- Config: allow ignore patterns and per-project settings later.

## TUI/CLI UX (MVP)
- TUI Alerts pane or inline system messages with action buttons (copy/reveal/open).
- CLI: `agentloop watcher list|add|remove|scan` with clear output and exit codes.

## Future (V1 ideas)
- “Add to project” action: shows patch/preview; requires explicit `--yes`.
- Batch view: list all unreferenced files and add selected ones.
- Per-project rules: ignore patterns, file-type→target mapping, grouping rules.
