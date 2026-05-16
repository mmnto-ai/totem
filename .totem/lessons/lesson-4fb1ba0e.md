## Lesson — Explicitly discard ignored catch parameters

**Tags:** dx, typescript, patterns
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Use an explicit discard like `void err` in catch blocks for intentional swallows to distinguish deliberate non-blocking behavior from accidental empty blocks.
