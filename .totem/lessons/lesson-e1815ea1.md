## Lesson — Preserve cohort versions during package renames

**Tags:** versioning, changesets, npm
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Renaming a package mid-lifecycle without a version bump preserves cohort coherence, even though the new package's registry history will start at the current version.
