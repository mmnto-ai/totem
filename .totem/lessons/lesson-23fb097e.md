## Lesson — Guard against newline-less slice truncation

**Tags:** typescript, parsing, strings
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Using `string.slice(0, string.indexOf('\n'))` without guarding against `-1` chops off the last character of a newline-less string. Always handle the `-1` fallback to prevent silent data truncation in edge-case inputs.
