# Totem: Agent Instructions

Canonical source of truth for how AI coding agents (Claude Code, Gemini CLI, Cursor, Windsurf, Copilot, etc.) behave in this repo. Per [Totem ADR-038](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-038-agents-md-standard.md), `mmnto-ai/totem` consolidates tool-specific instruction files into this single `AGENTS.md`. Thin `CLAUDE.md` / `GEMINI.md` redirect files exist only so each tool finds its way here.

## What Totem is

Totem is a **deterministic, git-native governance toolkit** — _rules you enforce, state you derive, context you query_. The moat is governance, not memory: lead with enforcement (`totem lint` + the gate engine), not recall. Derivation (`totem status` / `orient`, Tenet 20) and the queryable index serve it.

## Session Start Protocol (MANDATORY)

1. Run `totem status` for health; read the active milestone for momentum.
2. **NEVER GUESS ARCHITECTURE.** Before modifying any core system (hooks, orchestrator, compiler, extract pipeline), run `totem search <system_name>`.
3. Before writing code, call `search_knowledge` describing what you're changing.
4. Before planning, query `totem-strategy:search_knowledge` for ADRs.
5. Don't push speculative fixes. Run `totem lint` locally — front-load all checks before the first push.

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). TypeScript strict mode.
- `main` is protected. Feature branches + PRs. Never amend commits on feature branches. Use `Closes #NNN` in PR descriptions.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks, no empty catches.
- Named constants for magic numbers. Zod at system boundaries only.
- Run `pnpm run format` before committing.
- **NEVER put secrets in config files.** `.env` only.
- **Totem is NOT zero-user.** Ships in production for downstream consumers beyond this repo's dogfood. Breaking changes need migration paths, not just "fix in next major."

## Totem Workflow

Not mechanically enforced. Follow because they reduce PR bot noise.

- **Before coding:** `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify compile manifest is current.
- **After merging a PR:** `totem lesson extract <pr> --yes`, then `totem docs` if releasing. Lessons: `totem lesson extract <prs>` → `totem lesson compile`.
- **NEVER bypass quality gates without a ticket.** No `--no-verify`, `totem-ignore`, `eslint-disable`, `@ts-ignore`, skipped tests, or CI-pacifying ignore patterns. Suppressions need a ticket-ref comment.
- **Open PRs Ready, not Draft.** All three bots are on-demand (strategy#622); nothing auto-reviews a Draft OR a Ready PR — Ready signals review-readiness for the operator's trigger word.
- **Vendor routing.** Claude is the default code executor; Gemini stays strategic (proposals, ADRs, audits). Cross-vendor second-opinion fine both ways; "Gemini implement" is not the default.

## Contributor Principles

<!-- totem-ignore-next-line -->

- Update `AI_PROMPT_BLOCK` in `init.ts` when changing reflexes/hooks/prompts.
- GCA decline: add a lesson with `review-guidance` tag + update `.gemini/styleguide.md` § 6.
- Changesets: write `.changeset/` files manually. Use `pnpm run version` (never bare `pnpm version`).

## Bot-Protocol Gate (load-bearing — ADR-105 Layer 3)

Before posting ANY PR comment, replying to ANY bot, or running `gh pr comment` / `gh api .../comments`:

<!-- totem:cr-disclaimer: cross-repo doctrine refs into private cohort repos (e.g., mmnto-ai/totem-strategy) remain canonical even when CR's URL-accessibility check returns 404 from the bot account — this is an access-class signal per doctrine § 2.4, not a link-class signal -->

1. **Read** [`mmnto-ai/totem-strategy:doctrine/bot-protocols.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/doctrine/bot-protocols.md) if you haven't this session.
2. **Apply** the consolidated round-comment SOP (doctrine § 8.1) — ONE main-thread dispositions comment per round, structured table, tag only bots with a role this round; review triggers are NOT part of it (see 3).
3. **All three bots are on-demand, point-in-time, and operator-gated** (none auto-reviews or re-reviews a push; ruled 2026-06-10/11, [strategy#622](https://github.com/mmnto-ai/totem-strategy/issues/622)): post a review trigger (`@coderabbitai review` / `@greptileai review` / `/gemini review`) only on an explicit per-invocation operator word — prep the round, surface _"ready: invoke X, or merge as-is"_ with a recommendation, and on the word, post the trigger as its own standalone, triggers-only comment (an embedded trigger routes CR to chat-mode and no review runs — mmnto-ai/totem#2150; on Windows send leading-slash bodies via PowerShell so the slash isn't path-munged).
4. **Never** combine `@gemini-code-assist` + `/gemini review` in the same comment (doctrine § 1.2 — XOR Tag Rule).
5. **Never** reply citing a SHA before pushing (doctrine § 1.1).
6. **Workflow surface:** prefer the `/review-reply` skill — it operationalizes the SOP end-to-end.

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

- [Architecture context](.claude/docs/architecture.md)
- [Contributing rules](.claude/docs/contributing.md)
- [Agent workflow](.claude/docs/agent-workflow.md)
- [Gemini styleguide](.gemini/styleguide.md)
- Strategy ADRs: query `mcp__totem-strategy__search_knowledge`
