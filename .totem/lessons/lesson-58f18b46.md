## Lesson — Avoid using dynamic imports in shared utility modules

**Tags:** nodejs, cli, performance
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Avoid using dynamic imports in shared utility modules that are already part of the main entry-point's import tree. While dynamic imports help CLI startup speed, they are most effective when placed inside specific command handlers to defer loading of heavy dependencies that aren't globally required.
