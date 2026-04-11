## Lesson — Handle single-line inputs in regex terminators

**Tags:** regex, parsing
**Scope:** packages/mcp/src/tools/**/*.ts, !**/*.test.*

Regex patterns ending in \n+ will fail on single-line inputs lacking a trailing newline; use (?:\s*\n+|\s*$) to correctly match both line-endings and end-of-string.
