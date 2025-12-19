# AgentLoop — Agent Instructions

This repository uses **prompt macros**: some chat frontends (including Codex CLI) reserve `/...` for built-in commands, so macros here trigger on plain-language keywords instead of slash-commands.

## `ship` (release-ready pass)

When the user types `ship` (or `ship:` followed by optional notes), do the following:

1. **Summarize changes**: list the key modified areas/files and the intended outcome.
2. **Run fast checks** (prefer minimal scope first):
   - `bun run typecheck`
   - If there are repo tests, run the smallest relevant test command (otherwise skip).
3. **Fix issues you introduced**: iterate up to 3 times on failing checks caused by your changes; do not fix unrelated pre-existing failures.
4. **Hygiene**:
   - Confirm `.gitignore` covers local artifacts created by the workflow (venvs, caches, downloads).
   - Ensure docs/help text are updated if UX changed.
5. **Commit prep**:
   - Propose a commit message and brief body.
   - Show `git status --porcelain` output.
   - Ask for explicit confirmation before running any `git commit`, `git push`, `git reset`, or other destructive commands.

If you cannot run commands due to sandbox/approvals, proceed with steps that don’t require commands, then explicitly ask for approval only for the minimal needed commands.
