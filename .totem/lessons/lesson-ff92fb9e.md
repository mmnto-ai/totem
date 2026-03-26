## Lesson — Eagerly importing heavy modules at the top level of CLI

**Tags:** performance, cli, dx
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Eagerly importing heavy modules at the top level of CLI command files increases startup latency; use dynamic `import()` within handlers to keep help and version checks fast.
