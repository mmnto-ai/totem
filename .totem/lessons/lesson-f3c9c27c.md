## Lesson — Guard error message sentinel prefixes

**Tags:** dx, error-handling
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Avoid adding standard error prefixes to low-level helpers if downstream handlers use those prefixes as sentinels to detect and skip redundant wrapping. Adding a prefix prematurely can short-circuit context-wrapping logic in higher-level adapters.
