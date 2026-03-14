# Testing Conventions

This guide outlines the testing philosophy and patterns used in the Totem monorepo.

## 1. Co-Located Test Files

Tests in Totem are co-located next to the source files they verify. We do not use a separate `test/` or `__tests__/` directory.
- Source: `src/commands/init.ts`
- Test: `src/commands/init.test.ts`

This ensures that when an agent (or a human) modifies a file, the related tests are immediately visible in the same directory context.

## 2. Test Runner (Vitest)

We use Vitest for all test execution.

To run tests:
- **All packages:** `pnpm run test`
- **Specific package:** `pnpm -F @mmnto/cli test`

## 3. Unit vs. Integration Tests

- **Unit Tests (`*.test.ts`)**: Fast, isolated tests. They often mock filesystem operations (`fs`, `node:fs/promises`) and child processes.
- **Integration Tests (`*.integration.test.ts`)**: Tests that interact with real file systems, databases (LanceDB), or external APIs. These are typically separated to allow running fast unit tests continuously in watch mode.

## 4. Config Drift Tests

The `config-drift.test.ts` file is a unique architectural safeguard. It enforces that:
1. Agent instruction files (`CLAUDE.md`, `GEMINI.md`) share identical foundational project rules.
2. The reflexes we use internally match the `AI_PROMPT_BLOCK` we ship to consumers via `totem init`.
3. No secrets are accidentally hardcoded into tracked config files.

If you change an architectural rule or update the prompt strategy, you must update the corresponding drift assertions.

## 5. Exported Constants Pattern

You will frequently see constants exported from source files even if they are only used internally within that module. 
**Example:** `export const SPEC_SEARCH_POOL = 5;`

**Do not flag these as unused exports.** We deliberately export named limits, prompt strings, and threshold values so that co-located test files can import and assert against them directly.

## 6. Hook Test Patterns

When testing commands that manipulate the filesystem or git state (like `totem init` or `totem hooks`), follow these patterns:
- **Tmpdir Setup:** Always create a temporary directory for the test environment.
- **Git Init:** Run `git init` in the tmpdir if testing git hooks.
- **Idempotency Assertions:** Ensure that running the command twice yields the same result without errors or duplicate appending.

## 7. Test Fixtures and `totem-ignore`

When creating raw string fixtures that look like code with issues, you might trigger the `totem shield` or linting rules. Use the `// totem-ignore` or `/* totem-ignore */` directive inside test fixtures to prevent the compiler from aggressively flagging intentional test data.
