# Contributing Rules

## Git Conventions

- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions to auto-close issues, and declare each intended close with a `<!-- totem-close: #NNN -->` body marker — the D1 required check fails undeclared close keywords.
- Squash merge to main (user preference).

## PR Review Bot Protocol

This repository uses review bots. Review triggers are the maintainer's to post, never an agent's. Reply to findings through `/review-reply`: one dispositions comment per round, every addressed bot tagged once, a trigger never combined with a reply, and never cite a commit before it is pushed. The full protocol is maintained outside this repository and is not paraphrased here (paraphrases drift).

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

- Update `AI_PROMPT_BLOCK` in `init-templates.ts` when changing reflexes/hooks/prompts.
- No `totem-ignore`, `eslint-disable`, or `--no-verify` without a ticket.
