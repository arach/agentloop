# Agentic Operator (Runtime + UX)

Audience: small team of engineers building AgentLoop into a “delightful operator” for local agents + services.

This doc focuses on the runtime architecture and product behaviors required to make AgentLoop feel reliable, fast, and extensible.

---

## Product definition

An “agentic operator” is a local-first system that:
- routes user intent to the right behavior (chat vs debug vs tools vs edits)
- executes deterministically with clear safety gates
- surfaces state and progress without spamming the conversation
- is observable (logs, traces, timings) and debuggable
- can be extended via tools, prompt packs, and background jobs

---

## Architecture overview

### Components
- **TUI**: interaction layer, rendering, input, shortcuts, local log viewer.
- **Engine**: session state, routing, LLM calls, tool loop, event stream to TUI.
- **Services**: local daemons (MLX, kokomo, VLM) and installers.

### Data flows
1. User input (TUI) → `session.send` (engine)
2. Engine routes → selects agent pack + tool policy
3. Engine executes:
   - single-shot completion OR
   - tool loop (LLM ↔ tool calls)
4. Engine emits events → TUI:
   - status, tokens, final message
   - service status/logs
5. TUI renders:
   - clean conversation
   - dedicated logs + inspector + service health

---

## Operator state model

### Session states (minimum)
- `idle`: ready
- `routing`: deciding which agent to run (v2+)
- `thinking`: non-stream response in progress
- `streaming`: token stream in progress
- `tool_use`: tool loop running
- `error`: recoverable error (show in logs + minimal UI note)

### UI invariants
- Conversation contains only:
  - user messages
  - assistant messages
  - occasional user-facing system notes (rare)
- Everything else (tools, service logs, debug traces) goes to log panels.

---

## Prompting and routing strategy (operator behavior)

### Prompt stack
See `docs/specs/prompting-infra.md` and `docs/specs/agents-and-tool-use.md`.

Key operator constraints:
- Use the **fast path** (chat.quick) for low-latency replies.
- Escalate to tools/edits only when intent is explicit or high confidence.
- Keep a stable “contract” in core prompt; move specializations into agent packs.

### Router (v2)
The router outputs JSON-only decisions:
- selected agent
- allowed tools
- depth
- clarifying questions (optional)

Implementation:
- heuristic-first, model-second
- user override (“pin agent”) bypasses router

---

## Tool loop execution (operator correctness)

### Control-plane requirements
- Strict max tool calls (per agent)
- One tool call at a time (simplifies parsing and UI)
- Cancellation:
  - cancel current run (`session.cancel`)
  - abort long tool calls (v2+ via AbortSignal)

### Safety model
Introduce capability tiers:
- `read`, `write`, `exec`, `external`

Policy:
- Default agent packs should be `read`-only unless explicitly intended.
- Writes/exec require explicit user intent (command, confirmation, or session toggle).

### Error handling
- Tool errors never crash the engine; emit structured error events.
- Surface minimal user note (“failed; see logs”) and keep stack traces in logs.

---

## Observability (non-negotiable)

### Structured logs
All operator decisions and operations must be loggable:
- router decision + timing
- llm request/response sizes + timing
- tool call args/result (with redaction policy) + timing
- service status/logs + timing
- crash capture stack traces

### Traces/metrics (v3)
Optional but powerful:
- OpenTelemetry spans for `router`, `llm`, `tool`, `service`
- counters/histograms for latency and error rates

### “Single pane of glass”
TUI should provide:
- per-service logs and recent feed
- per-session event trace (optional toggle)
- perf summary for last message (TTFB, total, route, model)

---

## UX requirements (what “delight” looks like)

### Header information architecture
High-density, stable layout:
- left: product name + version + active agent (Auto/Pinned)
- right: connection + session state + engine target

### Right sidebar (services as a snapshot)
Services panel should be:
- a compact status table: installed/running/port/error
- clickable actions: start/stop/status
- a small “Recent” log tail (last 3–5 lines total)

### Progress feedback
For any non-trivial action:
- show state transition (routing/thinking/streaming/tool_use)
- show “connecting to engine”/“starting service” as lightweight status, not chat spam
- logs should always explain “what happened” and “why”

### Discoverability
Users should be able to find:
- available commands (`/help`)
- available agents/modes (`/agent list`)
- prompt editing (`/prompt`)
- service control (`/service`)
- tool inventory (v2+ “Tools” panel)

---

## Extensibility model

### Configuration surfaces
Recommended files:
- `.agentloop/workspace.md` / `.agentloop/workspace.local.md`
- `.agentloop/agents/*.md`
- `.agentloop/config.json` (limits, defaults, router settings, service prefs)

### Plugins (v3)
A plugin can provide:
- tools (registered with schemas)
- background jobs/watchers
- UI sections (optional; TUI plugins later)

Guardrails:
- plugins declare required capabilities
- operator can disable plugin tools per agent pack

---

## Milestones (operator roadmap)

### v1: Reliable single-session operator
- prompt stack + manual agent selection
- tool gating enforced by agent pack
- logs show all tool calls and engine events
- basic service management UX

Acceptance tests:
- no tool protocol in conversation
- service install/start shows progress in logs and clear status in UI
- MLX “simple chat” path is low latency and stable

### v2: Router + “fast by default”
- heuristic-first router + optional MLX router model
- pinned agent overrides
- perf panel + last-run trace view
- safer write/exec gates (confirmations)

Acceptance tests:
- “hi” routes to chat.quick consistently
- “fix this bug” routes to code.change/tool.use
- router decisions + timings visible in logs

### v3: Multi-agent operator
- stateless subagents (parallel research/review)
- background watchers (services + folders)
- prompt templating (`{file:...}` and optional `{cmd:...}` with allowlist)
- optional traces/metrics (OTel)

Acceptance tests:
- background watchers do not spam conversation
- subagent outputs appear as structured “reports”
- operator remains responsive during long jobs

