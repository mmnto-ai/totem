# Totem — Development Rules

## Git

- `main` is protected. Always use feature branches + PRs.
- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions.

## Environment

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`).
- Windows 11 + Git Bash. TypeScript strict mode.
- **NEVER put secrets in config files.** `.env` only.

## Code Style

- `kebab-case.ts` files, `err` (never `error`) in catch blocks, no empty catches.
- Named constants for magic numbers. Zod at system boundaries only.
- Run `pnpm run format` before committing.

## Publishing

- Changesets (write `.changeset/` files manually). Use `pnpm run version` (never bare `pnpm version`).

## Contributor Principles

<!-- totem-ignore-next-line -->

- Update `AI_PROMPT_BLOCK` in `init.ts` when changing reflexes/hooks/prompts.
<!-- totem-ignore-next-line -->
- GCA decline: add lesson with `review-guidance` tag + update `.gemini/styleguide.md` §6.
- No `totem-ignore`, `eslint-disable`, or `--no-verify` without a ticket.
- GCA replies: ONE `@gemini-code-assist` comment per PR.

## Totem

- After merging a PR: run `totem extract <pr> --yes`, then `totem docs` if releasing.
- **NEVER use `git push --no-verify`.** Fix the violation or file a ticket.
- Before planning/architecture, query `mcp__totem-strategy__search_knowledge` for ADRs.
- Before writing code, you MUST call `mcp__totem-dev__search_knowledge` with a query describing what you're about to change.
