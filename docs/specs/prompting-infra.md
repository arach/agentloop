# Prompting + Agents Architecture (v1 → v3)

Audience: small team of engineers building AgentLoop.

## Goals
- Delightful “happy path”: fast local responses by default, clear state, minimal friction.
- Control + extensibility: prompt packs and agents are composable and repo-local.
- Debuggable: every decision is logged with inputs/outputs and timings.
- Local-first: MLX is the default execution engine; services/tools are explicit.

---

## Core Concepts

### 1) Prompt hierarchy (stack)

AgentLoop composes prompts from multiple layers:

1. **Core System Prompt (shipped, stable)**
   - Contract: safety, tool protocol, “no chatter”, ask-before-destructive, concise defaults.
   - Versioned in repo (engine package). Not user-editable by default (optional “advanced override” later).

2. **Workspace Prompt (repo-local, editable)**
   - `.agentloop/workspace.md` (committed)
   - `.agentloop/workspace.local.md` (gitignored)
   - Encodes conventions, project goals, preferred services, glossary.

3. **Session Prompt (ephemeral)**
   - Set per session (UI/command), stored with the session.
   - Short-term constraints: “today: debug MLX”, “be extra terse”, “prefer diffs”.

4. **Agent Pack Prompt (selected)**
   - Specialization: chat vs debug vs architecture vs code changes vs tool use.

**Composition per LLM call**
- `system = core + (agent pack prompt) + (tool protocol block if tools enabled)`
- Additional `system` messages: workspace + session
- Conversation history appended with truncation rules per route

---

### 2) Agents = prompt packs + tool policy (not separate code paths)

An **Agent** is a config bundle:
- `prompt.md` (instructions)
- `tools_allowed` (subset of available tools)
- `model` (often same provider, different size)
- `limits` (max tool calls, max turns, truncation strategy)

Suggested built-in agents:
- `chat.quick` (no tools, ultra low latency)
- `debug.triage` (log-first, ask for repro, minimal code changes)
- `code.arch` (architecture discussion, no tools by default)
- `code.change` (surgical edits, typecheck-first habits)
- `tool.use` (explicit tool loop, higher max tool calls)

**Storage format**
- `.agentloop/agents/<name>.md` with frontmatter:
  - `name`, `model`, `temperature`, `tools`, `max_tool_calls`, `max_history_turns`

Example:
```md
---
name: chat.quick
model: mlx
temperature: 0.2
tools: []
max_turns: 8
---
Fast, conversational answers. No tools. No long plans unless asked.
```

---

### 3) Router (inner-loop classifier)

The router decides which agent to use per user message.

**Decision object (JSON-only)**
```json
{
  "agent": "chat.quick|debug.triage|code.arch|code.change|tool.use",
  "tools_allowed": ["..."],
  "depth": "low|med|high",
  "reason": "short string",
  "questions": ["optional clarifiers (0–2)"]
}
```

**Routing algorithm**
- Heuristic first (zero LLM): slash commands, greetings, obvious “explain”, obvious “edit code”.
- Tiny local router model second (MLX): when ambiguous.
- User override: pin agent for this session (Auto/Chat/Tools/Code/etc).

**Router prompt strategy**
- Short, strict output schema, “default to chat.quick when unsure”.
- Inspired by Kiro’s classifier style: “return ONLY JSON” + “default to the safer/simple mode”.

**Logging**
- `router.decision`: includes message summary metadata, chosen agent, tools allowed, router latency.

---

### 4) Execution loop (outer-loop)

Two execution modes:
- **Single-call** (`chat.quick`, `code.arch`): one MLX completion, no tools.
- **Tool loop** (`tool.use`, `code.change`): iterative LLM ↔ tools with max steps.

Non-negotiables:
- Tool protocol never leaks into conversation.
- Tool loop has strict max tool calls; on limit, produce best-effort answer.

---

## Prompt Strategies (what to emulate)

### Stable “contract” prompt
- Prefer behavioral constraints + interaction policies over personality.
- Keep it auditable and deterministic (avoid long narrative instructions).
- Encode “no conversation spam; logs go to logs” in core.

### Tool instructions belong with tool schemas
- For each tool: include “when to use / when not to use / examples”.
- Reduces global prompt bloat and improves reliability.

### Mode/agent gating is the main control lever
- Model choice and tool permissions differ by agent.
- Keep the router simple; allow user overrides.

---

## Milestones (v1 → v3)

### v1: Prompt layering + manual agents (no router yet)

Goal: prove the prompt stack and agent packs end-to-end; enable prompt iteration without code changes.

Deliverables:
- Engine prompt loader:
  - core prompt (bundled)
  - workspace prompt: `.agentloop/workspace.md` + `.agentloop/workspace.local.md`
  - session prompt stored in session state
- Agent registry:
  - built-in agents in `packages/engine/src/prompts/agents/`
  - optional overrides in `.agentloop/agents/`
- Manual selection:
  - TUI: `/agent list`, `/agent set <name>`, `/agent auto`
  - Header shows `agent=<name>`
- Tool gating enforced by engine:
  - agent’s allowed tools passed into the tool loop
- Logs:
  - `prompt.stack` (hashes + sources; full text only in debug)
  - `agent.selected`

Test checklist:
- Switching `chat.quick` vs `tool.use` changes behavior deterministically.
- Workspace prompt changes take effect without restart (or via explicit reload command).
- No tool protocol appears in conversation view.

---

### v2: Router + fast-path optimization (default “delight”)

Goal: “type anything and it just works” with low latency.

Deliverables:
- Router v0:
  - heuristic routing for obvious cases
  - MLX-based router for ambiguous ones (tiny model configurable)
- Default behavior:
  - short questions route to `chat.quick`
  - tool intent routes to `code.change` / `tool.use`
- Observability:
  - `router.decision` logs (inputs summarized + output + latency)
  - `llm.ttfb`, `llm.total_ms` per call
- UI:
  - sidebar shows current agent + Auto/Manual
  - one-click agent override (“pin”)

Test checklist:
- “hi” routes to `chat.quick` and answers locally via MLX.
- “add logging to X” routes to `code.change` (or `tool.use`) and uses tools.
- Router decisions are stable for a given input set.

---

### v3: Subagents + background jobs + power-user workflows

Goal: scale to complex tasks: multi-agent concurrency, background watchers, project automation.

Deliverables:
- Subagent runtime (stateless jobs):
  - spawn agent runs with isolated contexts
  - concurrency for research tasks vs editing tasks
- Background agents:
  - service health watcher
  - folder watcher (Xcode “files not in project”)
- Prompt templating:
  - `{file:...}` and `{cmd:...}` injection for workspace prompts/agents (OpenCode-style)
- Safety + approvals:
  - explicit dangerous actions gating in tool policies
  - improved confirmations inside TUI

Test checklist:
- Launch a “research” subagent while main session stays interactive.
- Background watcher reports to logs + UI badge, not conversation spam.
- Prompt templates resolve deterministically; resolutions visible in debug logs.

---

## Team Workflow / Ownership
- Treat prompts as code: PR reviewed, versioned, changelogged.
- Keep prompt packs small and composable.
- Add a “router test harness”:
  - sample messages → expected agent route (golden tests)
  - schema validation (router must output JSON-only)
  - fast CI without requiring an LLM (heuristic router tests).

