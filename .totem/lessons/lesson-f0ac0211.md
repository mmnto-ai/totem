## Lesson — Guard string operations on configuration values

**Tags:** validation, defensive-programming
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Always verify that configuration values are strings before calling methods like .includes() to prevent runtime exceptions when encountering malformed data types in config files.
