# Totem: Agent Instructions

Canonical source of truth for how AI coding agents (Claude Code, Gemini CLI, Cursor, Windsurf, Copilot, etc.) behave in this repo. Per [Totem ADR-038](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-038-agents-md-standard.md), `mmnto-ai/totem` consolidates tool-specific instruction files into this single `AGENTS.md`. Thin `CLAUDE.md` / `GEMINI.md` redirect files exist only so each tool finds its way here. Junie reads `.junie/guidelines.md` directly until that migration follows.

## Session Start Protocol (MANDATORY)

1. Run `totem status` for health; read the active milestone for momentum.
2. **NEVER GUESS ARCHITECTURE.** Before modifying any core system (hooks, orchestrator, compiler, extract pipeline), run `totem search <system_name>`.
3. Before writing code, call `search_knowledge` describing what you're changing.
4. Before planning, query `totem-strategy:search_knowledge` for ADRs.
5. Don't push speculative fixes. Run `totem lint` locally — front-load all checks before the first push.

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. Never amend commits on feature branches. Use `Closes #NNN` in PR descriptions.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks, no empty catches.
- Named constants for magic numbers. Zod at system boundaries only.
- Run `pnpm run format` before committing.
- **NEVER put secrets in config files.** `.env` only.

## Totem Workflow

Not mechanically enforced. Follow because they reduce PR bot noise.

- **Before coding:** `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify compile manifest is current.
- **After merging a PR:** `totem extract <pr> --yes`, then `totem docs` if releasing. Lessons: `totem lesson extract <prs>` → `totem lesson compile`.
- **NEVER use `git push --no-verify`.** Also no `totem-ignore` or `eslint-disable` without a ticket.

## Contributor Principles

<!-- totem-ignore-next-line -->

- Update `AI_PROMPT_BLOCK` in `init.ts` when changing reflexes/hooks/prompts.
- GCA decline: add a lesson with `review-guidance` tag + update `.gemini/styleguide.md` § 6.
- Changesets: write `.changeset/` files manually. Use `pnpm run version` (never bare `pnpm version`).

## Bot-Protocol Gate (load-bearing — ADR-105 Layer 3)

Before posting ANY PR comment, replying to ANY bot, or running `gh pr comment` / `gh api .../comments`:

<!-- totem:cr-disclaimer: cross-repo doctrine refs into private cohort repos (e.g., mmnto-ai/totem-strategy) remain canonical even when CR's URL-accessibility check returns 404 from the bot account — this is an access-class signal per doctrine § 2.4, not a link-class signal -->

1. **Read** [`mmnto-ai/totem-strategy:doctrine/bot-protocols.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/doctrine/bot-protocols.md) if you haven't this session.
2. **Apply** the consolidated round-comment SOP (doctrine § 8.1) — ONE main-thread comment per round, structured table, tag only bots with a role this round.
3. **Never** combine `@gemini-code-assist` + `/gemini review` in the same comment (doctrine § 1.2 — XOR Tag Rule).
4. **Never** reply citing a SHA before pushing (doctrine § 1.1).
5. **Workflow surface:** prefer the `/review-reply` skill — it operationalizes the SOP end-to-end.

Enforcement stack per [ADR-105](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-105-bot-protocol-centralization.md): (1) PreToolUse hooks (queued — `mmnto-ai/totem#1900`); (2) skill instructions; (3) **this AGENTS.md** (baseline awareness for all vendor sessions); (4) auto-memory pointer (`feedback_bot_protocols_centralized`).

## Skills

Claude Code skills live under `.claude/skills/`; invoke via `/<skill-name>`. Gemini CLI equivalents (when present) live under `.gemini/skills/`. Each `SKILL.md` is the authoritative definition.

- `/preflight <issue>` — spec + search before coding
- `/prepush` — format + lint + review before push
- `/postmerge <prs>` — extract lessons after merge
- `/signoff` — end-of-session memory + journal
- `/review-reply <PR>` — doctrine-aligned bot-comment triage

## Context Decay Prevention (Proposal 213)

After >15 turns of code changes: run `totem status`, re-query strategy ADRs for the system you're modifying, and state your architectural assumption before proceeding.

## Agent Discipline (ADR-063)

**Controller, not implementer.** Delegate code+test tasks to background agents. Keep this thread for decisions. Prefer Monitor over Bash `sleep` loops; use `/loop <prompt>` self-paced for poll-and-react.

## Detailed Docs (read when relevant)

- [Architecture context](.claude/docs/architecture.md) — partitions, boundary parameter, linked indexes
- [Contributing rules](.claude/docs/contributing.md) — `AI_PROMPT_BLOCK`, changesets, code style
- [Agent workflow](.claude/docs/agent-workflow.md) — dispatch templates, delegation rules
- [Gemini styleguide](.gemini/styleguide.md) — full code style and architecture rules (Gemini CLI sessions read this directly)
- Strategy ADRs: query `mcp__totem-strategy__search_knowledge`
