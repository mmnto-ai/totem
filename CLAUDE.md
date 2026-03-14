# Totem — Development Rules

## Git

- `main` is protected. Always use feature branches + PRs.
- Never amend commits on feature branches — create new commits.
- Use `Closes #NNN` in PR descriptions.

## Environment

- **Package manager:** pnpm (never npm or yarn). Use `pnpm dlx` (never `npx`).
- **Platform:** Windows 11 + Git Bash
- **Language:** TypeScript strict mode
- **NEVER put secrets, tokens, or API keys in config files** (`.mcp.json`, `settings.json`, etc.). Secrets live ONLY in gitignored `.env` files. Agents and MCP servers inherit env vars from the shell automatically.

## Code Style

- `kebab-case.ts` for files
- Use `err` (never `error`) in catch blocks
- No empty catch blocks — always log or throw
- Extract magic numbers into named constants
- Zod for runtime validation at system boundaries (config, API input)
- Run `pnpm run format` before committing new files

## Totem

- Before writing code, you MUST call the `mcp__totem-dev__search_knowledge` tool with a query describing what you're about to change.

## Publishing

- Changesets + npm OIDC trusted publishing
- Use `RELEASE_TOKEN` PAT for PRs (org blocks `GITHUB_TOKEN` from creating PRs)
- Use `pnpm run version` (never bare `pnpm version` — resolves to pnpm built-in)
- Changeset CLI doesn't work with piped stdin — write files manually to `.changeset/`

## Contributor Principles

<!-- totem-ignore-next-line -->

- **Consumer-first:** Changes to AI reflexes, hooks, or prompts must update the `AI_PROMPT_BLOCK` template in `init.ts`. Consumers must get updates out of the box.
<!-- totem-ignore-next-line -->
- **GCA decline reflex:** When declining a recurring GCA suggestion, add a lesson with `review-guidance` tag and update `.gemini/styleguide.md` §6 on the same PR.
