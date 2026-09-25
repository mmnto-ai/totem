## Lesson — Canonicalize paths to prevent Windows bypasses

**Tags:** windows, path, security
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Comparing raw paths can allow Windows 8.3 short names to bypass directory boundary checks. Canonicalizing both sides of the comparison prevents these bypasses.
