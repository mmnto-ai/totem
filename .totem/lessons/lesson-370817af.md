## Lesson — Augment heuristics with authoritative parser checks

**Tags:** ast-grep, validation, dx
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Heuristics for AST structures often miss semantic errors like invalid roots; invoking the actual tool parser against empty source provides a cheap, authoritative validation layer.
