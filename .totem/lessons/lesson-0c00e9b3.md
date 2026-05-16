## Lesson — Test TTL expiration via file backdating

**Tags:** testing, fs, cache
**Scope:** packages/core/src/session-id.test.ts

Use `fs.utimesSync` to backdate file modification times when testing TTL logic to avoid using real-time delays in test suites.
