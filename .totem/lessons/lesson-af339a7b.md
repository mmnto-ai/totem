## Lesson — Avoid embedding full markdown parsers

**Tags:** parsing, markdown, architecture
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

For simple marker scanning tasks, document known limitations (such as markers inside HTML comments) rather than embedding a complex markdown parser.
