## Lesson — Prefer regex over split for line extraction

**Tags:** dx, linting
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Using `/^[^\n]*/.exec(str)` instead of `split('\n')[0]` avoids false-positive lint triggers on common array-access idioms while remaining semantically identical.
