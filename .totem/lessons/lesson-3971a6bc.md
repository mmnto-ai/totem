## Lesson — Enforce strict boundaries on URL numeric IDs

**Tags:** regex, parsing
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Ensure numeric identifiers parsed from URLs are bounded by end-of-input or valid URL delimiters (such as `/`, `?`, or `#`). This prevents malformed trailing text from being silently accepted as part of the ID.
