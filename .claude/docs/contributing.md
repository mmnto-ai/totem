# Contributing Rules

## Git Conventions

- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions to auto-close issues.
- Squash merge to main (user preference).

## PR Review Bot Protocol

Two bots review PRs. Their interaction models are completely different -- confusing them causes missed feedback or duplicate noise.

### CodeRabbit (CR)

- Reply inline to any CR comment thread freely.
- CR reads every reply in its thread automatically -- no tagging needed.
- Supports `@coderabbitai fix` commands to trigger automated fixes.
- One reply per finding is fine; multiple back-and-forth exchanges are normal.

### Gemini Code Assist (GCA)

- ONE batched top-level PR comment per PR. Never reply inline to individual GCA comment threads.
- Every GCA reply MUST contain `@gemini-code-assist` -- GCA only sees messages that tag it explicitly.
- Batch all findings into a single numbered-list response: address each finding in order.
- GCA decline: add a lesson with `review-guidance` tag + update `.gemini/styleguide.md` §6.

> **WARNING:** Do not apply CR habits to GCA. Inline thread replies to GCA threads are invisible to GCA and will be silently ignored. Always compose one top-level comment with `@gemini-code-assist` and the full response.

## Publishing

- Changesets: write `.changeset/` files manually.
- Use `pnpm run version` (never bare `pnpm version`).
- After merge: `totem extract <pr> --yes`, then `totem docs` if releasing.

## Code Style

- Named constants for magic numbers.
- Zod at system boundaries only.
- `log.error()` must use `'Totem Error'` as the tag.
- no empty catches.
- **NEVER put secrets in config files.** `.env` only.
- **NEVER use `git push --no-verify`.** Fix the violation or file a ticket.

## Contributor Principles

<!-- totem-ignore-next-line -->

- Update `AI_PROMPT_BLOCK` in `init.ts` when changing reflexes/hooks/prompts.
- No `totem-ignore`, `eslint-disable`, or `--no-verify` without a ticket.
