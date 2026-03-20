# Workflow Automation — Hooks & Skills

## The Problem

AI agents (including Claude Code) drift from documented workflow rules during long sessions.
CLAUDE.md is read once at session start but gets compressed out of context over time.
The agent optimizes for speed over process, skipping steps like `totem spec` and `totem shield`.

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

**What should happen:** Run shield, verify no violations, format check.
**Commands:** `totem shield`, `totem lint`, `pnpm run format:check`
**Skill:** `/prepush`
**Hook:** `PreToolUse` blocks `git push` if `/prepush` hasn't been run (checks `.totem/cache/.shield-passed` timestamp, expires after 30 min).

### Phase 6: After PR Merge

**What should happen:** Extract lessons from the PR, wrap.
**Commands:** `totem wrap <pr-numbers> --yes`
**Skill:** `/postmerge <pr-numbers>`

### Phase 7: Before Release

**What should happen:** Verify tickets are closed, extract from all PRs since last release, triage, docs.
**Commands:** `totem wrap`, `totem triage --fresh`, `totem docs`
**Skill:** `/release-prep`

### Phase 8: End of Session

**What should happen:** Update memory, journal, handoff.
**Commands:** `totem handoff`
**Skill:** `/signoff`

## Hooks (Enforced by Harness)

| Hook               | Event                     | Purpose                                  | Status |
| ------------------ | ------------------------- | ---------------------------------------- | ------ |
| `PostCompact`      | After context compression | Re-inject critical CLAUDE.md rules       | Active |
| `PreToolUse(Bash)` | Before any Bash command   | Block `git push` if shield hasn't passed | Active |

## Skills (User-Invoked)

| Skill                | Usage                    | Steps                                                         |
| -------------------- | ------------------------ | ------------------------------------------------------------- |
| `/preflight <issue>` | Before starting a ticket | `totem spec` → `search_knowledge`                             |
| `/prepush`           | Before pushing code      | `totem lint` → `totem shield`                                 |
| `/postmerge <prs>`   | After merging PRs        | `totem wrap`                                                  |
| `/triage`            | Pick next work           | `totem triage --fresh`                                        |
| `/release-prep`      | Before cutting a release | verify tickets → `totem wrap` → `totem triage` → `totem docs` |
| `/signoff`           | End of session           | update memory → journal                                       |

## Agent Delegation (Subagent Patterns)

Claude Code can spawn background agents for mechanical tasks, preserving the main context window for decisions.

### What agents CAN do (local operations)

- `totem shield` — run and report verdict
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

This saves context from 30-40KB of test output per push cycle while keeping the mandatory gates (spec before, shield after) running.

## What This Does NOT Solve

- The agent will still drift on advisory steps (spec, search_knowledge) unless you invoke the skill
- Skills are user-invoked, not automatic — you have to remember to type `/preflight`
- Hooks can block actions but can't force the agent to do something proactively

The realistic expectation: hooks catch the hard gates (push without shield), skills make the rituals easy to invoke, and CLAUDE.md provides the advisory layer. The user remains the router.
