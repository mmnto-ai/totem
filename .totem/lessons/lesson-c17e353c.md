## Lesson — Normalize markdown blockquotes

**Tags:** markdown, parsing, html
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Markdown blockquote prefixes (e.g., `> `) on every line can break regexes designed to match multiline HTML tags like `<details>` and `<summary>`. Stripping blockquote prefixes prior to parsing ensures robust tag matching.
