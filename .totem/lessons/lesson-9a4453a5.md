## Lesson — File system watchers should monitor for "rename" events

**Tags:** nodejs, fs, toolchain

File system watchers should monitor for "rename" events rather than just "created" or "modified" to support editors that use atomic saves. Failure to handle renames often leads to stale caches and missed updates during development.
