## Lesson — Match diff headers with trailing spaces

**Tags:** git, parsing, regex
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Checking if a line starts with raw `+++` or `---` to identify diff headers can falsely match code lines like `++i;` or markdown headers. Always check for a trailing space (e.g., `+++ ` or `--- `) to safely distinguish metadata headers from code content.
