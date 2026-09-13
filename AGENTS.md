# Totem: Agent Instructions

Canonical source of truth for how AI coding agents behave in this repository. Following the AGENTS.md convention, `mmnto-ai/totem` consolidates tool-specific instruction files into this single `AGENTS.md`; thin per-tool redirect files point each tool here. Team-only instructions for this repository ride a private doctrine package and are never committed here.

## What Totem is

Totem is a local-first toolkit that keeps AI-agent work queryable, enforceable, and derivable as plain files in your codebase. Lead with enforcement (`totem lint` and the gate engine), not recall; derivation (`totem status`, `totem orient`) and the queryable index serve it.

<!-- totem:agents-floor:start -->
<!-- Managed by `totem init`: the span between these markers is refreshed in place; everything outside it is yours. -->

## Session start

1. Run `totem status` for health.
2. **Never guess architecture.** Before modifying a core system, run `totem search <system>`.
3. Before writing code, call `search_knowledge` describing what you are changing.
4. Do not push speculative fixes: run `totem lint` locally and front-load every check before the first push.
5. Cold start (no session hook injected orientation): derive it with `totem orient`, after `/signon`'s seat and assignment-mail steps where that skill is installed.

## Working rules

- Before pushing: your formatter, then `totem lint` (the enforcement floor), then `totem review` where configured (advisory lanes, never a merge gate).
- After a PR merges: `totem lesson extract <pr> --yes`.
- **Never bypass a quality gate without a ticket.** No `--no-verify`, `totem-ignore`, `eslint-disable`, `@ts-ignore`, skipped tests, or ignore patterns added to pacify CI; a suppression carries a ticket reference.
- After roughly 15 turns of code changes: run `totem status`, re-query the knowledge index for the system you are modifying, and state your architectural assumption.
- **Controller, not implementer.** Delegate build-and-test cycles to background agents; keep this thread for decisions.

## Review bots

If this repository uses review bots: review triggers are the maintainer's to post, never an agent's. Reply to findings through `/review-reply`, one dispositions comment per round, and never cite a commit before it is pushed.

## Installed skills

Where `totem init` installs the `/signon`, `/signoff`, `/review-reply` and `/review-loop` skills, every later `totem init` refreshes each one's managed span and keeps what you add below its end marker.

<!-- totem:agents-floor:end -->

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). TypeScript strict mode.
- `main` is protected. Feature branches + PRs. Never amend commits on feature branches. Use `Closes #NNN` in PR descriptions.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks, no empty catches.
- Named constants for magic numbers. Zod at system boundaries only.
- **NEVER put secrets in config files.** `.env` only.
- **Totem is NOT zero-user.** Ships in production for downstream consumers beyond this repo's dogfood. Breaking changes need migration paths, not just "fix in next major."

## Totem workflow

Not mechanically enforced. Follow because it reduces review noise.

- **Before coding:** `/preflight <issue>`. Create a feature branch.
- **Before pushing:** `pnpm run format` → `totem lint` → `totem review` → verify the compile manifest is current.
- **Open PRs Ready, not Draft.**
- **This repository uses review bots.** The review-bots conduct in the managed span above applies here.

## Contributor principles

<!-- totem-ignore-next-line -->

- Update `AI_PROMPT_BLOCK` in `init-templates.ts` when changing reflexes, hooks or prompts.
- Gemini Code Assist (GCA) decline: add a lesson with the `review-guidance` tag and update `.gemini/styleguide.md` § 6.
- Changesets: write `.changeset/` files by hand. Use `pnpm run version` (never bare `pnpm version`).

## Repository skills

Beside the installed ones: `/preflight <issue>` (spec + search before coding), `/prepush` (format + lint + review before push), `/postmerge <prs>` (extract lessons after merge). Skills also live under `.agents/skills/` for agents that read that path, a hand-kept copy of the `.claude/skills/` files until `totem init` writes both (mmnto-ai/totem#2788).

## Agent bus

<!-- totem:agent-bus role="bus" seat="totem-claude" declared="2026-07-16" primary="totem-claude" since="2026-08-14" -->

The marker above declares this repository's `agent-bus` binding, the one `totem doctor --parity` reads. It is the one agent identifier this file carries; its move into a committed config file is mmnto-ai/totem#2866.

## Detailed docs

- [Architecture](.claude/docs/architecture.md) · [Contributing](.claude/docs/contributing.md) · [Agent workflow](.claude/docs/agent-workflow.md) · [Gemini styleguide](.gemini/styleguide.md)
