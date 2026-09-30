## Lesson — Refuse unreadable Git entries explicitly

**Tags:** fs, git, error-handling
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Guessing the classification of a .git entry when fs.statSync fails can lead to incorrect repository resolution. Explicitly refusing unreadable entries prevents security and integrity bypasses.
