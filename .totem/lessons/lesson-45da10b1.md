## Lesson — Always release a filesystem lock before spawning

**Tags:** concurrency, patterns, architecture

Always release a filesystem lock before spawning a subprocess that intends to acquire the same lock to avoid deadlocks. This is critical when a parent process performs a write and then triggers a secondary sync or background task that shares the same locking mechanism.
