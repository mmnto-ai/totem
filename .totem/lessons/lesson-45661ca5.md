## Lesson — Guard string operations on untrusted JSON

**Tags:** typescript, validation, json
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Always validate that JSON fields are strings before calling methods like `.includes()` to prevent runtime crashes when encountering unexpected data types in user configuration.
