## Lesson — Avoid unnecessary writes during no-op runs

**Tags:** performance, fs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Only rewrite files during no-op runs if a transformation actually modified the data to prevent unnecessary disk I/O and git noise.
