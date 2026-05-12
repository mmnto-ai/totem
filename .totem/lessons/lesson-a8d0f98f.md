## Lesson — Harden regex patterns against ReDoS

**Tags:** security, regex, zod
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Combine a character length cap (e.g., 512 chars) with safety checks like `isRegexSafe` during schema validation to prevent catastrophic backtracking at runtime.
