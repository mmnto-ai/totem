## Lesson — Verify closure capture against compiler context

**Tags:** dx, llm, typescript
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Reviewer LLMs often lack outer-scope context and may incorrectly flag captured variables as ReferenceErrors. Verify these findings with `tsc` or empirical tests before modifying the architecture to satisfy the bot.
