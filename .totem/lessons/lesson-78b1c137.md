## Lesson — Ban do-nothing values in schemas

**Tags:** validation, schema
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Strictly rejecting empty arrays (like `excludeGlobs: []`) and empty exemplars prevents silent rule degradation and ensures every authored key carries active configuration.
