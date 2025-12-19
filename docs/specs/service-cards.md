# Spec: Service Cards & Clarity (M1-C)

Status: drafting. Owner: @agent.

## Goal
Make service state obvious and actionable: know what’s running, why something isn’t, and how to fix it in one click/keypress.

## Scope (MVP)
- Per-service card (kokomo/mlx/vlm) showing:
  - Status (running/stopped/error/unknown), pid (if local), port, last error/exit code.
  - Actions: start, stop, status, view logs.
  - “Why not running?” detail if error/stopped with lastError.
- Auto-refresh status on selection and after actions.
- Inline “fix” hints for common failures (missing install, port in use, permissions).
- Logs access: quick button/shortcut to switch to that service’s logs tab.

## Out of Scope (MVP)
- Managing arbitrary user-defined services (depends on plugin system, M2).
- Restart loops or health probes beyond current engine behavior.

## UX Notes
- TUI: services header shows selected service; selecting a service triggers status fetch and focuses actions.
- Errors reported as “Problem → Why → Fix” with suggested commands.
- No silent state changes; echo actions to system messages.

## Protocol/API
- Use existing service commands/events.
- No protocol change needed for MVP; rely on `service.status`/`service.log`.

## Acceptance Criteria
- Selecting a service shows status and last error (if any).
- Start/stop/status from card works and echoes result.
- Logs tab switches to selected service with one action.
