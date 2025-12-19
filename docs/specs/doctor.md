# Spec: `agentloop doctor` (M1-B)

Status: drafting. Owner: @agent.

## Goal
Single command to check environment readiness and print actionable fixes with exit codes for automation.

## Scope (MVP)
- Checks:
  - Bun present + version.
  - Python + uv present (for installers); report PATH issues.
  - Clipboard tooling (pbcopy / wl-copy / xclip / xsel) availability.
  - Audio playback tools (afplay, ffplay, or fallback note).
  - Ports availability (default engine/TUI ports) or random-port guidance.
  - File permissions: writable `.agentloop/`, `external/`.
- Output:
  - Human-readable summary with ✅/⚠️/❌.
  - Copyable remediation commands.
  - Exit code 0 on all pass, non-zero on failures (count failures in exit code? choose simple: 1).
- Flags:
  - `--json` for structured output (for scripts).
  - `--fix` optional? (No auto-fix in MVP; just suggestions.)

## Out of Scope (MVP)
- Installing dependencies automatically.
- Network checks beyond localhost ports.

## UX Notes
- Run from repo root: `bun run doctor` or `agentloop doctor`.
- For each failure: “Problem → Why → Fix”.
- Keep run time < 2s; skip heavy probes.

## Acceptance Criteria
- Running doctor on a clean macOS dev machine reports missing items accurately.
- JSON output is parseable and contains check name, status, detail, suggestedFix.
- Non-zero exit when any check fails.
