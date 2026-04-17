## Lesson — Guard external JSON field types

**Tags:** typescript, defensive-programming
**Scope:** packages/mcp/src/**/*.ts, !**/*.test.*

Apply runtime type guards to fields extracted from external files like package.json even after safe-reading. This prevents invalid data types from corrupting downstream objects if the file structure is malformed.
