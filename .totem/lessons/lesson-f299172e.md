## Lesson — Normalize temp paths for cross-platform equality

**Tags:** testing, filesystem, cross-platform
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Using realpathSync on temporary directories ensures path-equality assertions match git output across macOS symlinks and Windows short names.
