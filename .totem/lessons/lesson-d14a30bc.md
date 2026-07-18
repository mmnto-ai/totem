## Lesson — Support nested block comments in parsers

**Tags:** parsing, lexing, comments
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Rust block comments can be nested, so using a simple index-of search for the comment terminator will prematurely end the skip block and corrupt brace-depth tracking.
