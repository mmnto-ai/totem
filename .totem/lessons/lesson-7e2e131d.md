## Lesson — Always resolve repository root dynamically

**Tags:** cli, path-resolution
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Defaulting the repository root to process.cwd() fails when CLI commands are run from subdirectories. Using a walk-up resolver ensures consistent repository-relative path resolution regardless of the current working directory.
