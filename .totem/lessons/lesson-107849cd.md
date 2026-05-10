## Lesson — Guard against Windows teardown races

**Tags:** windows, testing, fs
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Use retries and delays (e.g., maxRetries: 3) for directory cleanup on Windows to prevent flakes caused by transient file handles from antivirus or indexing services.
