## Lesson — Guard against late-surfacing dynamic import failures

**Tags:** architecture, error-handling
**Scope:** packages/core/src/embedders/**/*.ts

Dynamic imports placed inside execution methods rather than constructors can bypass initialization-time fallback logic, deferring environment errors until the first call.
