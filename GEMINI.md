# Totem — Development Rules

## Essentials

- **pnpm only** (never npm/yarn). Use `pnpm dlx` (never `npx`). Windows 11 + Git Bash. TypeScript strict mode.
- `main` is protected. Feature branches + PRs. Never amend commits on feature branches.
- Use `Closes #NNN` in PR descriptions.
- `kebab-case.ts` files, `err` (never `error`) in catch blocks, no empty catches.
- Run `pnpm run format` before committing.
- **NEVER put secrets in config files.** `.env` only.

## Totem Workflow (BLOCKING)

- Before writing code: call `search_knowledge` with what you're changing
- Before planning/architecture: query `totem-strategy:search_knowledge` for ADRs
- After merging a PR: run `totem extract <pr> --yes`, then `totem docs` if releasing
- **NEVER use `git push --no-verify`.** Fix the violation or file a ticket.

## Contributor Principles

<!-- totem-ignore-next-line -->
- Update `AI_PROMPT_BLOCK` in `init.ts` when changing reflexes/hooks/prompts.
<!-- totem-ignore-next-line -->
- GCA decline: add lesson with `review-guidance` tag + update `.gemini/styleguide.md` §6.
- No `totem-ignore`, `eslint-disable`, or `--no-verify` without a ticket.
- GCA replies: ONE `@gemini-code-assist` comment per PR.

## Detailed Rules

- See `.gemini/styleguide.md` for full code style, naming, and architecture rules.
- Changesets: write `.changeset/` files manually. Use `pnpm run version` (never bare `pnpm version`).
- Named constants for magic numbers. Zod at system boundaries only.
