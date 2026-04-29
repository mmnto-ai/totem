## Lesson — Use containment coefficient for diff matching

**Tags:** math, algorithms, git
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Jaccard similarity fails for small patterns against large diffs because the union size dilutes the score; asymmetric containment coefficient remains stable regardless of diff size.
