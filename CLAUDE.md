# CLAUDE.md — mmnto-ai/totem

This file is auto-loaded into every Claude Code session opened in this repo. Keep it short. **Point to load-bearing surfaces; don't duplicate them.** Per `feedback_wallpaper_layers_antipattern`, the goal is to make the right surfaces discoverable, not to restate them.

## What this repo is

`mmnto-ai/totem` — the core totem CLI + packages (extractor, compiler, hook engine, pack ecosystem). Where features, fixes, and lessons land before they propagate.

## Load-bearing surfaces (READ when relevant)

| Concern                                                               | Path                                                                                                                                  | When to read                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Bot-interaction protocols** (CR, GCA, Greptile, CodeQL)             | [`mmnto-ai/totem-strategy:doctrine/bot-protocols.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/doctrine/bot-protocols.md) | **BEFORE** posting any PR comment, replying to any bot, or running `gh pr comment` / `gh api .../comments` |
| Architecture context (partitions, boundary parameter, linked indexes) | [`.claude/docs/architecture.md`](.claude/docs/architecture.md)                                                                        | Before modifying core systems (hooks, orchestrator, compiler, extract pipeline)                            |
| Contributing rules (git conventions, publishing, code style)          | [`.claude/docs/contributing.md`](.claude/docs/contributing.md)                                                                        | Before opening a PR; for `AI_PROMPT_BLOCK`, changesets, banned vocab                                       |
| Agent workflow (dispatch templates, delegation)                       | [`.claude/docs/agent-workflow.md`](.claude/docs/agent-workflow.md)                                                                    | When delegating to background agents (ADR-063)                                                             |
| Strategy ADRs / proposals / doctrine                                  | `mcp__totem-strategy__search_knowledge`                                                                                               | When citing an ADR or proposal number; check supersede banners                                             |
| Active milestone context                                              | [`docs/active_work.md`](docs/active_work.md)                                                                                          | At session start — follow any deprecation banner                                                           |

## The bot-protocol gate (load-bearing rule)

Before posting ANY PR comment, replying to ANY bot, or running `gh pr comment` / `gh api .../comments`:

1. **Read** `mmnto-ai/totem-strategy:doctrine/bot-protocols.md` if you haven't this session.
2. **Apply** the consolidated round-comment SOP (doctrine § 8.1) — ONE main-thread comment per round, structured table, tag only the bots that have a role in this round.
3. **Never** combine `@gemini-code-assist` + `/gemini review` in the same comment (doctrine § 1.2 — XOR Tag Rule; burns GCA quota).
4. **Never** reply citing a SHA before pushing (doctrine § 1.1 — GCA reviews stale state, wastes quota).
5. **Workflow surface:** prefer the `/review-reply` skill — it operationalizes the doctrine SOP end-to-end.

Enforcement stack (per [ADR-105](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-105-bot-protocol-centralization.md) in totem-strategy):

1. PreToolUse hooks (queued — `mmnto-ai/totem#1900`)
2. Skill instructions (`.claude/skills/review-reply/SKILL.md`, `.claude/skills/autofix/SKILL.md`)
3. **This CLAUDE.md** (Layer 3 — baseline awareness)
4. Auto-memory pointers (`feedback_bot_protocols_centralized` in agent memory)

## Session Start Protocol (MANDATORY)

Before writing any code or making any changes:

1. Run `totem status` for health and read `docs/active_work.md` for current milestone and momentum.
2. **NEVER GUESS ARCHITECTURE.** Before modifying any core system (hooks, orchestrator, compiler, extract pipeline), run `totem search <system_name>` to load architectural context from the knowledge base.
3. Do not push speculative fixes to "see what CI says." Run `totem lint` locally. Front-load all checks before the first push.

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. `Closes #NNN` in PR bodies.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks.
- Run `pnpm run format` before committing.

## Totem-Claude workflow

Not mechanically enforced. Follow these because they reduce PR bot noise.

- **Before coding:** Run `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify compile manifest is current.
- **After merging:** `totem lesson extract <prs>` → `totem lesson compile` (6+ lessons). The `--cloud` flag is off-path until #1221 migrates the cloud worker to Sonnet; local compile is the golden path.
- **NEVER** use `git push --no-verify`, `totem-ignore`, or `eslint-disable` without a ticket.
- Git pre-push hook runs `totem lint` + `totem verify-manifest` (stateless, no LLM).

**Context decay (Proposal 213):** after >15 turns of code changes, re-run `totem status`, re-query strategy ADRs for the system you're modifying, and state your architectural assumption before proceeding.

**Agent discipline (ADR-063):** Controller, not implementer. Delegate code+test tasks to background agents. Keep the main thread for decisions.

**Tool patterns:** Prefer Monitor over Bash `sleep` loops (Monitor only fires on events; `sleep; check` burns cache every iteration). Use `/loop <prompt>` without an interval for self-paced poll-and-react.

## Skill triggers (when to invoke)

- **`/preflight <issue>`** — spec + search before coding
- **`/prepush`** — format + lint + review before push
- **`/postmerge <prs>`** — extract lessons after merge
- **`/signoff`** — end-of-session memory + journal
- **`/review-reply <PR>`** — triage + reply to ALL bot comments on a PR (doctrine-aligned)
- **`/autofix`** — auto-apply CR review-thread fixes (one-bot subset of `/review-reply`)
- **`/code-review`** — request a fresh CR review
- **`/commit-commands:commit-push-pr`** — commit + push + open PR; runs pre-push checks including totem lint

## Memory model

Project-scoped auto-memory at `~/.claude/projects/D--dev-totem/memory/`. Per `feedback_wallpaper_layers_antipattern`: **default to subtraction.** Before adding a memory entry, check whether existing content covers it; prefer updating to adding.

Specifically for bot protocols: do NOT bank per-rule entries. The doctrine is canonical; memory holds ONE pointer (`feedback_bot_protocols_centralized`) plus institutional context that doesn't fit the doctrine.

## Substrate

Cohort communication lives in `mmnto-ai/totem-substrate` (checked out alongside totem in your dev env). Use:

- `.handoff/totem-claude/inbox/` for inbound
- `.handoff/<other-agent>/inbox/` for outbound dispatches
- `.journal/totem/claude-NNNN-*.md` for session journals

Substrate lint is zero-LLM (deterministic checks only) and runs on every commit.

## Quick agent-status lookup

The `totem-status` binary (built from `mmnto-ai/totem-status`) surfaces per-agent inbox counts, oldest unread, last processed, journals tip, and `.lancedb` index state in one screen. **First lookup** for any "what's everyone doing" question — do not walk inboxes manually (per `feedback_totem_status_canonical_agent_lookup`).

## When in doubt

The doctrine doc (`mmnto-ai/totem-strategy:doctrine/bot-protocols.md`) is the source of truth for bot protocols. This file is the entry point — it tells you where to look, not what to do.
