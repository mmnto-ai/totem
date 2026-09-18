## Lesson — Avoid loose thread discharge rules

**Tags:** github-api, validation, automation
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Reusing generic evidence rules like 'any human comment after a root' to discharge threads leads to false positives from normal PR chatter. Thread-level actions must be explicitly keyed to unique thread identifiers to prevent accidental discharges.
