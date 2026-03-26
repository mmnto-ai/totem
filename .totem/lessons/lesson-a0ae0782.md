## Lesson — Top-level imports of heavy classes or modules

**Tags:** performance, nodejs, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Top-level imports of heavy classes or modules can significantly degrade CLI startup performance. Use dynamic imports inside command function bodies to ensure the tool remains responsive for fast operations that don't require those dependencies.
