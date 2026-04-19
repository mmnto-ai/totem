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

Example hook for Gemini (`.gemini/hooks/SessionStart.js`):

```javascript
const { execSync } = require('child_process');
execSync('totem status', { stdio: ['ignore', 'inherit', 'inherit'] });
```

The agent now sees whether the manifest is fresh, whether the review stamp is stale, and the current rule and lesson counts before taking any action.

## 2. Deterministic Enforcement (Pre-Push Hook)

Context injection helps agents make better decisions, but it cannot guarantee compliance. The pre-push Git hook provides the hard guarantee:

```bash
$ git push
[Lint] Running 394 rules (zero LLM)...
### Errors
- **packages/cli/src/git.ts:22** — Never use native child_process
[Lint] Verdict: FAIL — Fix violations before pushing.
```

The agent cannot bypass this. When the lint gate fails, the push is rejected, and the agent is forced to fix the violation before trying again. The agent learns the architecture through mechanical failure, not by reading documentation.

## 3. MCP Knowledge Base

For agents that support the Model Context Protocol (MCP), Totem exposes the project's knowledge base as queryable tools. The agent can search lessons, ADRs, and architectural decisions before writing code:

```text
Agent: "What patterns are banned in the CLI package?"
→ search_knowledge("CLI banned patterns")
→ Results: "Direct child_process forbidden, use safeExec..."
```

This works with any MCP-compatible agent: Claude, Gemini, Cursor, Windsurf. See [MCP Server Setup](mcp-setup.md) for configuration.

## The Tradeoff

Context injection and the MCP knowledge base improve agent behavior but cannot guarantee it. The pre-push lint gate guarantees compliance but only catches violations at push time. Used together, the agent gets the context to write correct code and the tripwire to catch it when it doesn't.
