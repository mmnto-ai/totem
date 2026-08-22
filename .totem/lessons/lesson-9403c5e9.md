## Lesson — Cache regexes in hot evaluation loops

**Tags:** performance, regex
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Compiling RegExp instances repeatedly inside hot loops like `requiresContextPresent` introduces significant CPU overhead. Re-use or cache compiled patterns using a bounded cache to maintain performance.
