## Lesson — Bound entire runs under single budget

**Tags:** performance, process, security
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Establishing a unified timeout deadline at process entry protects downstream operations, like Git queries, from hanging under host execution limits when stdin is delayed.
