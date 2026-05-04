## Lesson — Anchor relative config paths to git root

**Tags:** cli, filesystem, dx
**Scope:** packages/core/src/**/*.ts

Relative paths in environment variables or config files should anchor at the git root rather than the current working directory to ensure consistent behavior across deep directory structures.
