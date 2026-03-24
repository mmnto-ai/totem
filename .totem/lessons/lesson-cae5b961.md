## Lesson — Operations like store.count() can throw after heavy inserts

**Tags:** database, lancedb

Operations like store.count() can throw after heavy inserts or FTS rebuilding; wrapping these in try/catch prevents reporting a successful sync as a failure.
