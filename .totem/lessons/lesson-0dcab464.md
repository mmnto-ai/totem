## Lesson — Use identity hashes over raw bytes

**Tags:** security, performance, artifacts
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Store content hashes instead of raw bytes in grounding artifacts to identify evidence. This prevents artifact bloat and avoids creating a secondary Data Loss Prevention (DLP) surface for sensitive content already tracked elsewhere.
