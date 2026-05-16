## Lesson — Enforce non-empty strings for path schemas

**Tags:** zod, validation, fs
**Scope:** packages/core/**/*.ts, !**/*.test.*

Zod schemas for file paths must use `.min(1)` because empty strings in `path.join(repoRoot, path)` resolve to the repository root, causing false positives in existence checks.
