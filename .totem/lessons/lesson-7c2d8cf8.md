## Lesson — Guard hook drift repair with end markers

**Tags:** git, hooks, security
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Automatic drift-repair of hooks can silently overwrite user-appended scripts if ownership is not tightly bounded. Ensure all hook templates use explicit end-markers and abort no-force updates if trailing content is detected.
