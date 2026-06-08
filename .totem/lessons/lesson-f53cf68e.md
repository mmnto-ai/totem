## Lesson — Default absent sourceRepo to current repo

**Tags:** metadata, grounding, dx
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Omit the `sourceRepo` field from grounding metadata when the item belongs to the run's own repository. This convention reduces artifact bloat while allowing consumers to safely assume the local repo is the source when the field is missing.
