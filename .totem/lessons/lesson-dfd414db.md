## Lesson — Decode Git C-quoting when parsing diff headers

**Tags:** git, parsing, encoding
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Git diff headers for hunk-less changes or paths with special characters and spaces often use C-style quoting and octal escapes. Parsers must decode these escapes and handle quoted operands to correctly identify file paths.
