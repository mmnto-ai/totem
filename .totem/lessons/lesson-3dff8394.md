## Lesson — Reject unsafe status check IDs

**Tags:** github, security, serialization
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Database IDs used as ordinals must be validated as safe JavaScript integers (under 2^53 - 1) before comparison. Unsafe IDs parsed by JSON.parse can round, resulting in incorrect ordering, and must fail closed.
