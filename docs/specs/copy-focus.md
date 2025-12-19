# Spec: Copy & Focus UX (M1-D)

Status: drafting. Owner: @agent.

## Goal
Reliable, unsurprising copy behavior and clear focus/selection rules.

## Scope (MVP)
- Explicit copy actions:
  - Copy selection (Cmd/Ctrl+C when selection exists; Quick Action; slash command optional).
  - Copy last assistant, last code block, last audio path.
- Clear feedback:
  - Toast/system message on copy success/failure (no double messages).
  - No auto-clearing selection unless user requests it.
- Focus rules:
  - Clicking panels updates focus consistently.
  - Keybindings (^R, ^N, ^A, ^C) behave even after mouse use.
- Defaults:
  - Drag-to-select auto-copy OFF by default (env opt-in `AGENTLOOP_AUTOCOPY_SELECTION=1`).
- Safety:
  - ^C quit is “press twice” to avoid collisions with copy.

## Out of Scope (MVP)
- Rich clipboard formats.
- Cross-session clipboard history.

## Acceptance Criteria
- Selecting text + Cmd/Ctrl+C copies and reports once; selection stays unless user clears.
- Quick Actions for copy work regardless of focus state.
- No surprise auto-copy in default env; opt-in works when env var set.
- Focus is visible and consistent after mouse clicks and keyboard navigation.
