## Lesson — Incremental logic must apply the same ignore patterns

**Tags:** architecture, git, performance

Incremental logic must apply the same ignore patterns as full-scan paths to prevent processing excluded files like lockfiles or vendored code. This ensures consistency between fast-path and standard review cycles.
