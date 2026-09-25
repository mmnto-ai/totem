## Lesson — Validate repository path segment counts

**Tags:** regex, validation
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Restrict path matching regexes to exactly two segments for owner and repository. This prevents nested paths, such as action runs or subdirectories, from being misparsed as valid repository names.
