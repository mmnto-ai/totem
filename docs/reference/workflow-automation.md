# Workflow Automation — Hooks & Skills

## The Problem

AI agents (including Claude Code) drift from documented workflow rules during long sessions.
CLAUDE.md is read once at session start but gets compressed out of context over time.
The agent optimizes for speed over process, skipping steps like `totem spec` and `totem review`.

## The Solution: 3 Layers (Same Architecture as Totem)

| Layer          | Mechanism                           | What it does                                                                |
| -------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| **Suggestion** | `CLAUDE.md`                         | Tells the agent the rules. Works at session start, degrades over time.      |
| **Fast Path**  | Skills (`/preflight`, `/prepush`)   | User-invoked shortcuts that run the right totem commands at the right time. |
| **Guarantee**  | Hooks (`PreToolUse`, `PostCompact`) | Harness-enforced gates. Agent cannot skip them.                             |

## Workflow Phases & Commands

### Phase 1: Start of Session

**What should happen:** Agent re-familiarizes with the project.
**Mechanism:** `PostCompact` hook re-injects rules automatically. For a fresh session, use `/preflight` with the first ticket.

### Phase 2: Pick a Ticket

**What should happen:** Triage recommends the next ticket.
**Command:** `totem triage --fresh`
**Skill:** `/triage`

### Phase 3: Before Starting Work on a Ticket

**What should happen:** Generate a spec, search knowledge for relevant lessons/traps.
**Commands:** `totem spec <issue>`, `mcp__totem-dev__search_knowledge`
**Skill:** `/preflight <issue>`

### Phase 4: During Development

**What should happen:** Write code, run tests, lint.
**Commands:** `totem lint`, `pnpm run test`
**No skill needed** — this is the agent's natural workflow.

### Phase 5: Before Push

**What should happen:** Format, lint, review — cheapest checks first.
**Commands:** `pnpm run format:check`, `totem lint`, `totem review`
**Skill:** `/prepush`
**Hook:** `PreToolUse` blocks agent `git push` if review hasn't passed (checks `.totem/cache/.reviewed-content-hash` against current source files). Human pushes are unaffected.

### Phase 6: After PR Merge

**What should happen:** Extract lessons from the merged PR(s), re-sync the index, compile new rules locally, review the resulting rules by hand.
**Commands:** `totem lesson extract <prs> --yes`, `totem sync`, `totem lesson compile --export`, `git checkout HEAD -- .totem/compiled-rules.json`
**Skill:** `/postmerge <pr-numbers>`
**Note:** `totem wrap` is retired pending [mmnto-ai/totem#1361](https://github.com/mmnto-ai/totem/issues/1361) because its `totem docs` step silently overwrote hand-crafted committed documentation. Run the individual commands directly.

### Phase 7: Before Release

**What should happen:** Verify tickets are closed, extract from all PRs since last release, version bump, then docs.
**Order matters:** extract → changeset → `pnpm run version` → `totem docs` (docs must run _after_ version bump so the LLM sees the correct version in git tags)
**Commands:** `totem extract`, `pnpm run version`, `totem docs`
**Skill:** `/release-prep`

### Phase 8: End of Session

**What should happen:** Update memory, journal, handoff.
**Commands:** `totem handoff`
**Skill:** `/signoff`

## Hooks (Enforced by Harness)

| Hook               | Event                     | Purpose                                                     | Status |
| ------------------ | ------------------------- | ----------------------------------------------------------- | ------ |
| `PostCompact`      | After context compression | Re-inject rules + capability manifest (ADR-063)             | Active |
| `PreToolUse(Bash)` | Before `git commit`       | **Block** if `/preflight` hasn't been run on feature branch | Active |
| `PreToolUse(Bash)` | Before `git push`         | **Block** if `/prepush` hasn't been run                     | Active |

Exempt branches (commit gate only): `main`, `master`, `hotfix/*`, `docs/*`, detached HEAD.

## Skills (User-Invoked)

| Skill                | Usage                    | Steps                                                           |
| -------------------- | ------------------------ | --------------------------------------------------------------- |
| `/preflight <issue>` | Before starting a ticket | `totem spec` → `search_knowledge`                               |
| `/prepush`           | Before pushing code      | `format` → `totem lint` → `totem review`                        |
| `/postmerge <prs>`   | After merging PRs        | `totem extract` → `totem sync` → `totem compile --export`       |
| `/triage`            | Pick next work           | `totem triage --fresh`                                          |
| `/release-prep`      | Before cutting a release | `totem extract` → changeset → `pnpm run version` → `totem docs` |
| `/signoff`           | End of session           | update memory → journal                                         |

## Agent Delegation (Subagent Patterns)

Claude Code can spawn background agents for mechanical tasks, preserving the main context window for decisions.

### What agents CAN do (local operations)

- `totem review` — run and report verdict
- `totem lint` / `totem lint-lessons` — validate rules
- `pnpm run test` / `pnpm run lint` — test suites
- File reads, searches, code generation

### What agents CANNOT do (sandbox restrictions)

- `git push` — network operations are blocked
- `gh pr create` — GitHub CLI requires network
- MCP tool calls — run in a separate process

### Recommended pattern

1. Main agent writes code, makes decisions
2. Delegate shield/lint/test to a background agent
3. Continue working on strategy or next task while agent runs
4. When agent reports back, main agent does the push + PR

This saves context from 30-40KB of test output per push cycle while keeping the mandatory gates (spec before, review after) running.

## What This Does NOT Solve

- The agent will still drift on advisory steps (spec, search_knowledge) unless you invoke the skill
- Skills are user-invoked, not automatic — you have to remember to type `/preflight`
- Hooks can block actions but can't force the agent to do something proactively

The realistic expectation: hooks catch the hard gates (push without review), skills make the rituals easy to invoke, and CLAUDE.md provides the advisory layer. The user remains the router.
