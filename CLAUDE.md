# Totem — Development Rules

## Session Start Protocol (MANDATORY)

Before writing any code or making any changes:

1. Run `totem briefing` to understand current state and momentum.
2. Read `docs/active_work.md` to understand the active milestone.
3. **NEVER GUESS ARCHITECTURE.** Before modifying any core system (hooks, orchestrator, compiler, extract pipeline), run `totem search <system_name>` to load architectural context from the knowledge base.
4. Do not push speculative fixes to "see what CI says." Run `totem lint` locally. Front-load all checks before the first push.

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. `Closes #NNN` in PR bodies.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks.
- Run `pnpm run format` before committing.

## Totem Workflow

Not mechanically enforced. Follow these because they reduce PR bot noise.

- **Before coding:** Run `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify compile manifest is current.
- **After merging:** `totem lesson extract <prs>` → `totem lesson compile` (6+ lessons). The `--cloud` flag is off-path until #1221 migrates the cloud worker to Sonnet; local compile is the golden path.
- **NEVER** use `git push --no-verify`, `totem-ignore`, or `eslint-disable` without a ticket.
- Git pre-push hook runs `totem lint` + `totem verify-manifest` (stateless, no LLM).

## Skills

- `/preflight <issue>` — spec + search before coding
- `/prepush` — format + lint + review before push
- `/postmerge <prs>` — extract lessons after merge
- `/signoff` — end-of-session memory + journal

## Context Decay Prevention (Proposal 213)

After >15 turns of code changes: run `totem status`, re-query strategy ADRs for the system you're modifying (don't rely on stale context), and state your architectural assumption before proceeding.

## Agent Discipline (ADR-063)

- **Controller, not implementer.** Delegate code+test tasks to background agents. Keep this thread for decisions.

## Tool Patterns

- **Prefer Monitor over Bash `sleep` loops.** Background long-running processes and Monitor them. `sleep; check` burns cache every iteration; Monitor only fires on events.
- **`/loop` self-paced for poll-and-react.** `/loop <prompt>` without an interval lets the model self-cadence. Example: `/loop watch CI, react when green`.

## Detailed Docs (read when relevant)

- [Contributing rules](.claude/docs/contributing.md) — PR bot protocol (CR/GCA), AI_PROMPT_BLOCK, changesets
- [Architecture context](.claude/docs/architecture.md) — partitions, boundary parameter, linked indexes
- [Agent workflow](.claude/docs/agent-workflow.md) — dispatch templates, delegation rules
- Strategy ADRs: query `mcp__totem-strategy__search_knowledge`
