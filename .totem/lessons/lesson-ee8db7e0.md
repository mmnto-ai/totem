## Lesson — Utilize fs.existsSync() as a fast-path optimization

**Tags:** nodejs, performance, fs

Utilize `fs.existsSync()` as a fast-path optimization for missing files to avoid the overhead of entering `try/catch` blocks for expected non-existent data. Retain the `ENOENT` check within the `catch` block as a safety net to handle Time-of-check to time-of-use (TOCTOU) race conditions.
