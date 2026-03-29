# Totem — Development Rules

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. `Closes #NNN` in PR bodies.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks.
- Run `pnpm run format` before committing.

## Totem Workflow

Not mechanically enforced. Follow these because they reduce PR bot noise.

- **Before coding:** Run `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify compile manifest is current.
- **After merging:** `totem lesson extract <prs>` → `totem lesson compile --cloud <url>` (6+ lessons).
- **NEVER** use `git push --no-verify`, `totem-ignore`, or `eslint-disable` without a ticket.
- Git pre-push hook runs `totem lint` + `totem verify-manifest` (stateless, no LLM).

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
