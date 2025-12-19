# AgentLoop Roadmap

Audience: technical builders/thinkers who want control, local services, and a hackable open canvas (TUI-first, CLI-friendly). Multi-agent friendly: each work item has an owner slot to avoid overlap.

## Milestones

### M1 — First 5 Minutes Are Perfect (Onboarding + UX polish)
- **M1-A Command palette & discoverability**: searchable commands, shortcuts, “what can I do now?” hints. Owner: @agent
- **M1-B `agentloop doctor`**: env checks (Bun, Python/uv, ports, clipboard, audio), copyable fixes, exit codes. Owner: @agent
- **M1-C Service clarity**: per-service card (status, why/fix, logs), clearer errors, good defaults. Owner: @agent
- **M1-D Copy/focus polish**: explicit copy actions, consistent selection/focus, no surprise auto-copy. Owner: @agent

### M2 — Extensible Open Canvas (Plugins + Profiles)
- Plugin manifest/loader (workspace + `.agentloop/plugins`), stable interfaces: Tool, Service, Watcher, AgentProfile. Owner: ___
- Config profiles (`default`, `local-mlx`, `tts-quirky`, …) + `agentloop config effective`. Owner: ___
- TUI surfaces installed plugins/profiles. Owner: ___

### M3 — Flow Runner + Debuggability
- Flow definition format (steps/conditions/timeouts/retries) + engine runner. Owner: ___
- Trace timeline + exportable trace bundle (with redaction hooks). Owner: ___
- Record/replay for sessions. Owner: ___

### M4 — Companion & Watchers (opt-in personality + background)
- Persona packs (voice/sound cues), background runner/daemon, notifications/menubar/hotkey. Owner: ___
- Watchers framework (file/system events). Owner: ___
- **Xcode project watcher** (alert on files not in `.xcodeproj`; add-flow later) — **last ticket in roadmap**. Owner: ___

## Near-Term Backlog (M1 slices)
- [x] Spec: command palette & discoverability (M1-A)
- [x] Spec: `agentloop doctor` checks + remediation (M1-B)
- [x] Spec: service cards/error messaging (M1-C)
- [x] Spec: copy/focus UX (M1-D) — current state documented; decide defaults

## Notes
- Specs live under `docs/specs/*.md`; write a 1–2 page spec before protocol/API changes.
- Protocol changes must update `docs/protocol.md` (versioned schema).
