## Lesson — Anchor relative paths to git root

**Tags:** cli, configuration
**Scope:** packages/core/src/**/*.ts

Relative environment or configuration values should anchor at the git root rather than the current working directory to ensure consistent behavior in deep monorepo structures.
