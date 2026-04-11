## Lesson — Extract shared logic into pure helpers

**Tags:** architecture, testing
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Extracting transformation logic into pure, non-mutating helpers ensures consistency across active and no-op branches while simplifying unit testing.
