## Lesson — Resolve substrate files relative to configRoot

**Tags:** cli, filesystem
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Use the repository's configRoot instead of the current working directory (cwd) when looking up persistent substrate files to ensure consistent behavior across different execution contexts.
