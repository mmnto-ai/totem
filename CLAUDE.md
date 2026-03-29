# Totem — Development Rules

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. `Closes #NNN` in PR bodies.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks.
- Run `pnpm run format` before committing.

## Totem Workflow

Not mechanically enforced — no local gates or flag files. Follow these because they reduce PR bot noise. If you skip a step, PR bots and CI catch it.

### Before coding
1. Run `/preflight <issue>` (runs `totem spec` + `mcp__totem-dev__search_knowledge`)
2. Create a feature branch from `main`

### Before pushing
1. Run `pnpm run format`
2. Run `totem lint` — fix any errors (the git pre-push hook also runs this)
3. Run `totem review` — fix any critical findings (voluntary, but saves PR bot loops)
4. Verify compile manifest is current — if you added/changed lessons, run `totem lesson compile`

### After merging
1. Run `totem lesson extract <pr-numbers>` to capture lessons from bot reviews
2. Run `totem lesson compile --cloud <url>` for 6+ lessons (local for ≤5)

### Rules
- **NEVER** use `git push --no-verify`, `totem-ignore`, or `eslint-disable` without a ticket.
- The git pre-push hook runs `totem lint` and `totem verify-manifest` — these are stateless, fast, and deterministic. No LLM, no flag files.

## Skills

- `/preflight <issue>` — spec + search before coding
- `/prepush` — format + lint + review before push
- `/postmerge <prs>` — extract lessons after merge
- `/signoff` — end-of-session memory + journal

## Agent Discipline (ADR-063)

- **Controller, not implementer.** Delegate code+test tasks to background agents. Keep this thread for decisions.
- Read [agent workflow](.claude/docs/agent-workflow.md) for dispatch templates and delegation rules.

## Detailed Docs (read when relevant)

- [Contributing rules](.claude/docs/contributing.md) — GCA replies, AI_PROMPT_BLOCK, changesets
- [Architecture context](.claude/docs/architecture.md) — partitions, boundary parameter, linked indexes
- [Agent workflow](.claude/docs/agent-workflow.md) — controller/worker pattern, when to delegate
- Strategy ADRs: query `mcp__totem-strategy__search_knowledge`
