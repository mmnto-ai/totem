## Lesson — Confine dynamic imports to CLI command handlers to maintain

**Tags:** architecture, cli, performance
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Confine dynamic imports to CLI command handlers to maintain a clean dependency graph and prevent shared utility layers from triggering security scanner flags.
