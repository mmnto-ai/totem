## Lesson — Centralize model IDs in CLI initialization

**Tags:** cli, refactoring, dry
**Scope:** packages/cli/src/commands/init-detect.ts

Avoid duplicating model ID literals when constructing both configuration objects and display blocks; using constants prevents version drift when defaults are updated.
