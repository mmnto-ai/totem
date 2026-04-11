## Lesson — Account for leading whitespace in line-start parsers

**Tags:** parsing, dx
**Scope:** packages/mcp/src/tools/**/*.ts, !**/*.test.*

Parsers using start-of-string anchors (^) should allow for leading whitespace or use trimStart() to prevent failures caused by leading blank lines in user input.
