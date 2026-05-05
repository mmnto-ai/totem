## Lesson — Sanitize untrusted metadata before logging

**Tags:** security, logging
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Metadata sourced from external files or user input should be sanitized before logging to prevent terminal injection attacks via malicious control characters.
