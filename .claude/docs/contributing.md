# Contributing Rules

## Git Conventions

- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions to auto-close issues.
- Squash merge to main (user preference).

## GCA (Gemini Code Assist)

- ONE consolidated `@gemini-code-assist` comment per PR (not per finding).
- GCA decline: add lesson with `review-guidance` tag + update `.gemini/styleguide.md` §6.

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
