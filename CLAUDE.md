# Totem — Development Rules

## Session Start Protocol (MANDATORY)

Before writing any code or making any changes:

1. Run `totem status` for health and read `docs/active_work.md` for current milestone and momentum.
2. **NEVER GUESS ARCHITECTURE.** Before modifying any core system (hooks, orchestrator, compiler, extract pipeline), run `totem search_knowledge <system_name>` to load architectural context.
3. Do not push speculative fixes to "see what CI says." Run `totem lint` locally. Front-load all checks before the first push.

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. `Closes #NNN` in PR bodies.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks.
- Run `pnpm run format` before committing.

## Totem Workflow

Not mechanically enforced. Follow these because they reduce PR bot noise.

- **Before coding:** Run `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify compile manifest is current.
- **After merging:** `totem lesson extract <prs>` → `totem lesson compile` (6+ lessons).
- **NEVER** use `git push --no-verify`, `totem-ignore`, or `eslint-disable` without a ticket.
- Git pre-push hook runs `totem lint` + `totem verify-manifest` (stateless, no LLM).

## Bot-Protocol Gate (load-bearing — ADR-105 Layer 3)

Before posting ANY PR comment, replying to ANY bot, or running `gh pr comment` / `gh api .../comments`:

1. **Read** [`mmnto-ai/totem-strategy:doctrine/bot-protocols.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/doctrine/bot-protocols.md) if you haven't this session.
2. **Apply** the consolidated round-comment SOP (doctrine § 8.1) — ONE main-thread comment per round, structured table, tag only bots with a role this round.
3. **Never** combine `@gemini-code-assist` + `/gemini review` in the same comment (doctrine § 1.2 — XOR Tag Rule; burns GCA quota).
4. **Never** reply citing a SHA before pushing (doctrine § 1.1 — GCA reviews stale state, wastes quota).
5. **Workflow surface:** prefer the `/review-reply` skill — it operationalizes the SOP end-to-end.

Enforcement stack per [ADR-105](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-105-bot-protocol-centralization.md): (1) PreToolUse hooks (queued — `mmnto-ai/totem#1900`); (2) skill instructions; (3) **this CLAUDE.md** (baseline awareness); (4) auto-memory pointer (`feedback_bot_protocols_centralized`).

## Skills

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
- Strategy ADRs: query `mcp__totem-strategy__search_knowledge`
