## Lesson — When using file paths in SQL LIKE clauses, normalize

**Tags:** sql, lancedb, security

When using file paths in SQL `LIKE` clauses, normalize backslashes and explicitly escape `%` and `_` characters to prevent accidental wildcard matching. This ensures a boundary search for a directory like `packages/core/` does not unintentionally match `packages/core-utils/`.
