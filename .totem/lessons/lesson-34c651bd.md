## Lesson — Validate DSL patterns with authoritative parsers

**Tags:** ast-grep, validation, dx
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Heuristic brace-counting fails to catch patterns that are balanced but semantically invalid as root nodes, such as floating member calls or bare catch clauses. Invoking the actual parser at compile time prevents runtime crashes in the linting engine.
