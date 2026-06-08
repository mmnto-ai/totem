## Lesson — Canonically sort bundle items

**Tags:** hashing, determinism, grounding
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Grounding bundle items must be sorted by identity fields (sourceType, sourceRepo, filePath, contentHash) before hashing. This ensures the resulting hash remains stable even if the underlying retrieval order changes due to score fluctuations.
