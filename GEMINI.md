# Totem — Development Rules

## Git

- `main` is protected. Always use feature branches + PRs.
- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions.

## Environment

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`).
- **Platform:** Windows 11 + Git Bash. **Language:** TypeScript strict mode.
- **NEVER put secrets in config files.** Secrets live ONLY in gitignored `.env` files.

## Code Style

- `kebab-case.ts` files, `err` (never `error`) in catch blocks, no empty catches.
- Extract magic numbers into named constants. Zod at system boundaries only.
- Run `pnpm run format` before committing.

## Reflexes

- Before writing code, you MUST call `search_knowledge` with a query describing what you're about to change.
- Before planning/architecture, query `totem-strategy:search_knowledge` for ADRs and research.
- After merging a PR: run `totem extract <pr> --yes`, then `totem docs` if releasing.
- **NEVER use `git push --no-verify`.** If shield fails, fix it or file a ticket.

## Publishing

- Changesets (write `.changeset/` files manually). Use `pnpm run version` (never bare `pnpm version`).

## Contributor Principles

<!-- totem-ignore-next-line -->

- **Consumer-first:** Update `AI_PROMPT_BLOCK` in `init.ts` when changing reflexes/hooks/prompts.
<!-- totem-ignore-next-line -->
- **GCA decline reflex:** Add lesson with `review-guidance` tag + update `.gemini/styleguide.md` §6.
- **No suppression without tickets.** No `totem-ignore`, `eslint-disable`, or `--no-verify` without a ticket.
- **GCA replies:** ONE consolidated `@gemini-code-assist` comment per PR — never individual threads.
