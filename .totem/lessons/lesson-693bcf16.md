## Lesson — Treat vector indexes as local-only caches that are excluded

**Tags:** git, architecture, vector-db

Treat vector indexes as local-only caches that are excluded from version control and rebuilt via synchronization commands. This avoids repository bloat and constant merge conflicts inherent in committing frequently changing binary database artifacts.
