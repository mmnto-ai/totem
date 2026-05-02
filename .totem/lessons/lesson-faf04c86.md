## Lesson — Resolve monorepo root paths eagerly

**Tags:** monorepo, paths
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Eagerly resolve the repository root to ensure global files like '.totemignore' are correctly located relative to the root rather than subpackage directories.
