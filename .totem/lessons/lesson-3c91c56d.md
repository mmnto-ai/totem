## Lesson — Correctly track escaped backslashes in strings

**Tags:** parsing, lexing, string-handling
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Naive escape-character checks that only look at the preceding character fail to correctly terminate strings ending in an escaped backslash (e.g., "\\"), which can corrupt brace-depth tracking.
