## Lesson — Prefer re-exported types in signatures

**Tags:** typescript, dx
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Use re-exported types directly in function signatures instead of inline import() types to improve code readability and simplify the module's public interface.
