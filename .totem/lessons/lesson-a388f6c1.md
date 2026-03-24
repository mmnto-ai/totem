## Lesson — Testing Conventions

**Tags:** maintainer, testing, vitest, conventions

### Testing Conventions
Tests in Totem are co-located next to the source files they verify (e.g., `src/commands/init.ts` and `init.test.ts`). We do not use separate `__tests__/` directories. We use Vitest for all execution (`pnpm run test`).

Config Drift Tests: The `config-drift.test.ts` file is an architectural safeguard. It enforces that `CLAUDE.md` and `GEMINI.md` share identical foundational rules, and the `AI_PROMPT_BLOCK` matches what we ship via `totem init`.

Exported Constants Pattern: Constants are frequently exported from source files even if only used internally within that module. Do not flag these as unused exports. They are deliberately exported so co-located test files can assert against them directly.

Test Fixtures: When creating string fixtures that look like code with issues, use `// totem-ignore` or `/* totem-ignore */` inside the fixture to prevent the compiler from aggressively flagging intentional test data.

**Source:** mcp (added at 2026-03-24T19:07:57.084Z)
