# Agents + Tool Use

Audience: engineers extending AgentLoop’s agent system and tools.

## Definitions

### Agent
An **agent** is a configuration bundle that controls:
- Prompt pack (instructions)
- Model + sampling settings
- Allowed tools (capabilities)
- Limits (max tool calls/steps, history window, timeouts)

Agents should be “policy”, not “code paths”: the runtime should be mostly shared, with agent configs determining behavior.

### Tool
A **tool** is a deterministic function the agent can call to interact with the local system:
- filesystem reads/listing
- service status/health
- domain-specific helpers (logo fetch)

Tools must be:
- small, composable, well-scoped
- safe by default (no destructive actions without explicit user intent)
- fully logged (inputs, outputs, duration)

---

## Agent taxonomy (recommended)

### `chat.quick` (default for short messages)
- Tools: none
- Goal: lowest latency, conversational, no planning unless requested
- History: short (e.g. last 6–10 turns)

### `debug.triage`
- Tools: read-only status/log tools
- Goal: ask for exact errors/logs, propose minimal repros, isolate root cause

### `code.arch`
- Tools: none (or read-only)
- Goal: explain tradeoffs, propose architecture, produce plan/diagram, avoid edits by default

### `code.change`
- Tools: read-only + safe repo edits (if enabled in this mode)
- Goal: surgical patches, run `bun run typecheck` when appropriate

### `tool.use`
- Tools: broad (but still policy gated)
- Goal: structured tool loop with explicit max steps and tight summaries

---

## Prompt packs

### File format
Store agent packs as markdown with frontmatter:

```md
---
name: code.change
model: mlx
temperature: 0.1
tools:
  - fs.read
  - fs.list
  - service.status
  - logo.fetch
max_tool_calls: 3
max_history_turns: 20
---
You are in `code.change` mode.
Prioritize small patches, run typecheck when finished, and keep chat output clean.
```

### Composition rules
For each LLM call:
1. Core system prompt (stable contract)
2. Agent pack prompt (selected)
3. Tool protocol block (only if tools enabled)
4. Workspace prompt (repo-local)
5. Session prompt (ephemeral)
6. Conversation messages (truncated by mode)

---

## Tool calling protocol

AgentLoop currently supports a text protocol for tool calls:

- To call a tool, the assistant emits exactly one line:
  - `TOOL_CALL: {"name":"...","args":{...}}`
- Tool results are provided back to the agent:
  - `TOOL_RESULT: {...}`
- User-facing output must never include `TOOL_CALL` / `TOOL_RESULT`.

### Guardrails
- One tool call at a time (simplifies parsing and UI)
- Hard cap on tool calls per response loop (e.g. `max_tool_calls`)
- If the cap is reached: strip protocol artifacts and return best-effort text

---

## Tool gating (capabilities)

Tools are enabled per agent. The runtime must enforce:
- **Tool allowlist**: only tools listed for this agent are callable
- **Argument validation**: schema validation for every tool input
- **Path safety**: repo-relative paths only for fs tools; block traversal/absolute paths

Optional next step (v2+):
- Split tools into `read` and `write` categories.
- Add a second gate: “user intent” must be explicit to unlock writes.

---

## Routing (agent selection)

### Router output contract (JSON-only)
The router is a classifier that returns **only** a single JSON object.

Recommended shape:
```json
{
  "agent": "chat.quick|debug.triage|code.arch|code.change|tool.use",
  "depth": "low|med|high",
  "tools_allowed": ["fs.read", "service.status"],
  "intent": "chat|question|debug|edit|tool",
  "confidence": 0.0,
  "reason": "short string",
  "questions": []
}
```

Rules:
- Default to `chat.quick` if uncertain.
- `tools_allowed` must be a subset of the selected agent’s tools.
- `questions` should be 0–2 items; empty means “go execute”.

### Heuristic-first router
To minimize latency and keep routing stable:
- If input begins with `/`, route to command handling (not LLM).
- If message is short and conversational, route to `chat.quick`.
- If message contains “error”, “stack trace”, “hang”, “why doesn’t”, route to `debug.triage`.
- If message asks for “design”, “architecture”, “tradeoffs”, route to `code.arch`.
- If message contains imperative “add/fix/refactor/implement” and mentions files, route to `code.change`.
- Only call the router model when the heuristic cannot decide.

### Manual overrides
Users should be able to pin an agent:
- `Auto` (router chooses)
- `Pinned: <agent>` (router bypassed)

Logging:
- Always log `router.decision` with a short input summary + duration.

---

## Tool schema patterns

Tools should be strongly typed and schema-validated.

### Result shape
Recommend a consistent envelope:
```ts
type ToolResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: string; detail?: unknown };
```

Guidelines:
- Return structured data, not prose.
- Put large payloads behind a `preview` + `bytes` + `path` pattern when possible.
- Never throw uncaught exceptions; convert to `{ok:false,...}`.

### Timeouts and cancellation
- Tools that call localhost services must have timeouts.
- Tool runtime should accept an AbortSignal (v2+) so cancels can interrupt long calls.

### Redaction + logging policy
Tools should declare a logging policy:
- `logArgs: full|safe|none`
- `logResult: summary|safe|none`

Default:
- Log inputs and outputs in debug mode.
- Log safe summaries in normal mode (truncate big blobs).

---

## Permissions and “write” tools (operator safety)

As soon as AgentLoop supports write/mutating tools (file edits, git, package installs), add a capability gate:

### Capability tiers
- `read`: safe introspection (fs.read, fs.list, service.status)
- `write`: modifies repo state (edit files, add files, apply patch)
- `exec`: runs commands (bun, git, installers)
- `external`: network access (if enabled)

### User intent gate (recommended)
Writes/exec should require one of:
- explicit user command (`/apply`, `/commit`, `/install --yes`)
- explicit user phrasing (“please implement this change”)
- a per-session toggle (“Allow writes for this session”)

### Dry-run / preview pattern
For write/exec tools:
- preview first (show diff/plan), then require confirmation to apply
- log every destructive action as a single structured record

---

## Prompt templating (workspace + agents)

Prompt files should support limited, explicit includes to keep prompts modular:

### `{file:...}` include
- Include the content of a repo-relative file into the prompt.
- Must enforce repo-relative paths only (no absolute paths, no traversal).
- Add size caps and truncation strategy (`maxBytes`, `head/tail`).

### `{cmd:...}` injection (v3)
- Execute a **read-only**, allowlisted command and inject stdout.
- Default off; requires explicit enablement.
- Always log: command, cwd, exit code, stdout length, stderr length.

---

## Subagents and background jobs (operator ergonomics)

### Stateless subagent jobs
Subagents are launched for parallelizable tasks (search, research, long-running analysis).
They must be:
- stateless (no follow-up messages)
- bounded (time/step limit)
- safely scoped (read-only by default)

Typical subagent roles:
- `research`: codebase scanning + summarization
- `code-review`: review diffs after changes
- `docs`: generate/update docs

### Background jobs
Background jobs should write to logs and surface lightweight status in the UI:
- service health watcher (mlx/kokomo/vlm)
- installer progress watcher
- folder watcher (Xcode use case)

Rules:
- no background chatter in the conversation
- show only: badges, short status lines, and “view logs” affordances

---

## UI contract (operator experience)

To keep the system usable:
- Conversation shows only user + assistant (plus minimal, user-facing system notes).
- Tools and service noise stays in a dedicated log view.

Recommended UI affordances:
- “Active agent” indicator + override control (Auto/Pinned)
- “Tool activity” indicator (spinner + last tool name)
- “Service health” summary (installed/running/port/error)
- Quick actions for common flows (copy, status, start service, open prompt editor)

---

## Testing + evaluation

### Router tests (no LLM required)
- Golden tests: input → expected agent + allowed tools
- JSON schema validation: router output must parse and conform

### Tool policy tests
- Ensure forbidden tool calls are rejected with clear errors.
- Ensure path traversal is blocked for file tools.

### Latency benchmarks
Track:
- router decision ms
- LLM TTFB (first token)
- total response ms
- tool call durations

Run a tiny benchmark suite locally on common prompts:
- greeting
- short question
- “explain this file” (read-only)
- “make a small code change” (tool loop)

---

## Logging + observability requirements

To keep chat clean, the UI should not show tool protocol or background events.
Instead, all tool activity must be visible in logs:

Minimum log events:
- `router.decision` (agent chosen, tools allowed, duration)
- `llm.request` (agent, model, input sizes, duration)
- `tool.call` (tool name, args, duration)
- `tool.result` (summary + ok/error; full result in debug mode)
- `perf.first_token` + `perf.complete` for streaming paths

Guideline:
- Log full payloads in debug mode.
- In normal mode, log safe summaries (truncate large blobs).

---

## Adding a new tool (engineering checklist)

1. **Define the tool contract**
   - `name`
   - `args` schema (zod or equivalent)
   - `result` schema (structured JSON)
   - clear description + examples

2. **Implement tool runtime**
   - pure function (or minimal side effects)
   - strict validation
   - deterministic outputs
   - timeouts for network/service calls

3. **Add tool policy**
   - which agents can call it by default
   - whether it’s “read-only” vs “write”
   - any additional gates (confirmation, allowlist, etc.)

4. **Expose in UI**
   - list it in `/help` or a discoverable tools panel
   - keep tool output out of the conversation feed
   - ensure logs show inputs/outputs and errors

5. **Test**
   - unit tests for schema validation and edge cases (if tests exist)
   - manual smoke test from the TUI

---

## Anti-patterns
- Tools that do too much (hard to reason about, hard to secure)
- Tool results shown directly in the chat (noise, breaks UX)
- Agents that differ only by “vibes” without tool/model policy differences
- Router that always calls an LLM (unnecessary latency + instability)
