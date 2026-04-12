## Lesson — Guard command line string construction

**Tags:** dx, formatting
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*

When building command strings for error messages, ensure the logic handles empty argument arrays to avoid trailing or double spaces in the output.
