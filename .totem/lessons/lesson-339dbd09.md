## Lesson — Normalize findings by stripping transient metadata

**Tags:** data-processing, clustering
**Scope:** packages/core/**/*.ts, !**/*.test.*

To enable stable clustering across PRs, signatures must strip transient metadata like file paths, line numbers, code fences, and URLs from finding bodies to ensure identity is based on core content.
