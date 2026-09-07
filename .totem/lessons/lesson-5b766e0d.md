## Lesson — Fallback to PATH for local CLI wrappers

**Tags:** cli, bootstrap, node
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

CLI wrappers that only probe repo-local `node_modules` can block bootstrap commands on fresh clones. Fall back to resolving the CLI from the system `PATH` while maintaining local-first precedence to prevent self-blocking bootstrap loops.
