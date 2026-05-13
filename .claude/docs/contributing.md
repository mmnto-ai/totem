# Contributing Rules

## Git Conventions

- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions to auto-close issues.
- Squash merge to main (user preference).

## PR Review Bot Protocol

See [`mmnto-ai/totem-strategy:doctrine/bot-protocols.md`](https://github.com/mmnto-ai/totem-strategy/blob/main/doctrine/bot-protocols.md) — canonical per [ADR-105](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-105-bot-protocol-centralization.md). Doctrine § 8.1 is the consolidated round-comment SOP (reply structure, @-mention rules, XOR Tag Rule, quota management, decline framing). Do not paraphrase here (paraphrases drift). Same retire-to-pointer pattern as `mmnto-ai/totem-playground@80b4d1b`.

## Publishing

- Changesets: write `.changeset/` files manually.
- Use `pnpm run version` (never bare `pnpm version`).
- After merge: `totem lesson extract <pr> --yes`, then `totem docs` if releasing.

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
