## Lesson — Consolidate dynamic imports in command functions

**Tags:** cli, performance, architecture
**Scope:** packages/cli/src/commands/shield.ts

Grouping multiple utility functions into a single dynamic import block at the start of a command function reduces boilerplate and improves maintainability in lazy-loaded CLI environments.
