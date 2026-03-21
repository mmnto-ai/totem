# Agent Workflow — Controller/Worker Pattern

## Principle (ADR-063 + Superpowers)

The main conversation is the **Controller**. It plans, dispatches, reviews, and commits.
It **never** writes implementation code directly when the task involves build/test cycles.

Subagents are **Workers**. They receive a focused task, execute it, and report back.
Their context is ephemeral — they don't carry session history.

## When to Delegate

Delegate to a background agent when:
- The task involves writing code + running tests (build/test cycle)
- The output would be >5KB of terminal text (test results, lint output)
- The task is mechanical (format, lint, shield, test)

Do NOT delegate when:
- The task requires architectural decisions
- The task needs MCP tool calls (agents can't access MCP)
- The task needs git push / PR creation (network blocked in sandbox)
- The task is a 1-2 line change (overhead exceeds benefit)

## Dispatch Template

When spawning a worker agent, provide:
1. **Files to modify** — exact paths
2. **What to change** — specific instructions, not vague goals
3. **Test command** — how to verify
4. **Report format** — "report success/failure and any errors"

Example:
```
Implement Task 2 in packages/core/src/lesson-linter.ts:
- Add onWarn parameter to validateLessons
- Thread it through lintLesson
- Run: cd packages/core && pnpm exec vitest run src/lesson-linter.test.ts
- Report: pass/fail count and any errors
```

## Review Protocol

When the agent reports back:
1. Read the changed files (agent can't commit)
2. Verify the changes match the spec
3. Run totem lint if the agent didn't
4. Commit with proper message
5. Move to next task

## What This Solves

- Context window stays clean for decisions (~16K agent tokens vs ~35K inline)
- Implementation details don't pollute the strategic thread
- Failed attempts don't accumulate in the main conversation
- Multiple tasks can run in parallel when independent
