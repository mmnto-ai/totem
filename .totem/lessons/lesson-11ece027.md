## Lesson — Hoist validation gates before expensive operations

**Tags:** performance, cli, git
**Scope:** packages/cli/src/commands/spine-authored-materialize.ts

Validation gates that do not depend on heavy I/O results should be hoisted before expensive operations like Git diff resolution. This prevents wasting resources and execution time when a command is destined to fail.
