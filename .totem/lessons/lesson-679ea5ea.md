## Lesson — Hoist immutable adapter capability checks

**Tags:** optimization, logic
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Move adapter capability checks outside of loops when the adapter is instantiated once, as repeated checks inside the loop are redundant and slightly impact performance.
