## Lesson — Destructure CLI options before passing to core

**Tags:** typescript, cli, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

CLI-specific options should be destructured and removed from options objects before passing them to core functions. This maintains strict TypeScript type safety and prevents unexpected CLI-only flags from leaking into core APIs.
