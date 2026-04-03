## Lesson — Detect package managers in generated hooks

**Tags:** git-hooks, dx, dev-tools
**Scope:** packages/cli/src/commands/install-hooks.ts

Avoid hardcoding specific package managers in git hook templates; detecting the project's active manager (pnpm, npm, yarn, or bun) ensures the hook remains compatible across different developer environments.
