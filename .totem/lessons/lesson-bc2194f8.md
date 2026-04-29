## Lesson — Use unique temp names for atomic writes

**Tags:** fs, concurrency, node
**Scope:** packages/cli/**/*.ts, !**/*.test.*

When performing atomic writes using a 'write-then-rename' strategy, include process.pid or a random suffix in the temporary filename to prevent collisions during concurrent executions.
