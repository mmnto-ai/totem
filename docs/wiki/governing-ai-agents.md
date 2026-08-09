# Governing AI Agents

AI coding agents (Claude, Gemini, Cursor) are effective at solving the code directly in front of them but suffer from a fundamental limitation: they are stateless. Every new session starts from zero, with no memory of prior incidents or the shared helpers you've already written.

Static documentation files (`CLAUDE.md`, `GEMINI.md`) help, but agents don't reliably act on instructions loaded into context. If governance depends on the agent reading and following a rule, it will eventually be ignored.

Totem addresses this with two mechanisms: **context injection** (give the agent the right information at session start) and **deterministic enforcement** (block violations mechanically when the agent tries to push).

## 1. Context Injection (Session Start Hooks)

Wire `totem status` into your agent's startup hook so the agent receives the project's live health state before it takes any action:

```text
[Status] Branch: main (dirty)
[Status] Rules: 439 compiled
[Status] Lessons: 1134
[Status] Manifest: fresh
[Status] Shield: stale (code changed since last pass)
```

Example hook for Gemini (`.gemini/hooks/SessionStart.cjs` — the `.cjs` extension is load-bearing: the body is CommonJS, and a repo whose `package.json` declares `"type": "module"` would resolve a bare `.js` as ESM and the hook would throw before emitting the briefing. Note Gemini CLI only executes hooks registered through a `settings.json` `hooks` entry (project, user, or system level — or an extension); there is no filename-convention discovery, so wire the script through one per the vendor's hooks docs):

```javascript
const { spawnSync } = require('child_process');
const run = spawnSync('totem status', {
  shell: true,
  timeout: 20000,
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
// The Totem CLI writes its banner to stderr — capture BOTH streams, and emit
// the hookSpecificOutput envelope: interactive Gemini ingests SessionStart
// output ONLY from hookSpecificOutput.additionalContext (plain stdout wraps
// as systemMessage, which the interactive startup consumer never reads).
const briefing = (run.stdout || '') + (run.stderr || '');
process.stdout.write(
  JSON.stringify({
    systemMessage: briefing,
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: briefing },
  }) + '\n',
);
```

The agent now sees whether the manifest is fresh, whether the review stamp is stale, and the current rule and lesson counts before taking any action. (The managed hook `totem init` distributes does exactly this — with `totem describe` + `totem orient --session` as the briefing legs and fail-soft error handling; prefer it over hand-rolling.)

## 2. Deterministic Enforcement (Pre-Push Hook)

Context injection helps agents make better decisions, but it cannot guarantee compliance. The pre-push Git hook enforces the compiled rules mechanically at push time:

```bash
$ git push
[Lint] Running 394 rules (zero LLM)...
### Errors
- **packages/cli/src/git.ts:22** — Never use native child_process
[Lint] Verdict: FAIL — Fix violations before pushing.
```

When the lint gate fails, the push is rejected until the agent fixes the violation. The agent learns the architecture through mechanical failure, not by reading documentation. Bypassing the hook takes an explicit `git push --no-verify` — and CI re-runs the same gates against the pushed tree, so the violation still surfaces in the PR checks.

## 3. MCP Knowledge Base

For agents that support the Model Context Protocol (MCP), Totem exposes the project's knowledge base as queryable tools. The agent can search lessons, ADRs, and architectural decisions before writing code:

```text
Agent: "What patterns are banned in the CLI package?"
→ search_knowledge("CLI banned patterns")
→ Results: "Direct child_process forbidden, use safeExec..."
```

This works with any MCP-compatible agent: Claude, Gemini, Cursor, Windsurf. See [MCP Server Setup](mcp-setup.md) for configuration.

## The Tradeoff

Context injection and the MCP knowledge base improve agent behavior but cannot ensure it. The pre-push lint gate runs the configured lint checks before every push; it catches modeled violations at push time. Used together, the agent gets the context to write correct code and the tripwire to catch it when it doesn't.
