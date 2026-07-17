## Lesson — Propagate POSIX chmod failures during installation

**Tags:** node, os, permissions
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Swallowing file permission errors during hook installation can mask failures to make files executable. Skip `chmod` explicitly on Windows, but let POSIX `chmod` failures propagate to prevent false-positive successes.
