## Lesson — Enforce RFC 4122 semantics in UUID tests

**Tags:** testing, security, uuid
**Scope:** packages/**/*.test.ts

Use specific regex patterns in tests to validate UUID v4 version and variant nibbles rather than just checking for a generic hex-dash structure.
