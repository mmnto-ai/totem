## Lesson — Internal DI plumbing changes may remain patches

**Tags:** semver, changesets
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Removing exported functions used only for internal dependency injection doesn't necessitate a major bump if the public callable surface remains intact and no external consumers are affected.
