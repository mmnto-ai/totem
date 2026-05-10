## Lesson — Dynamic imports can bypass constructor fallbacks

**Tags:** architecture, error-handling
**Scope:** packages/core/src/embedders/**/*.ts, !**/*.test.*

Loading SDKs dynamically inside methods prevents fallback logic that triggers on construction failure. Ensure critical dependency checks occur during instantiation if they influence provider selection.
