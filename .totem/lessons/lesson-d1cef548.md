## Lesson — Prefer semantic limits over line counts

**Tags:** llm, dx, testing
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Use character and directive counts instead of line counts for LLM instruction limits, as LLMs consume tokens and semantic density rather than physical lines.
