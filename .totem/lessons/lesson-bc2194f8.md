## Lesson — Use unique temp names for atomic writes

**Tags:** fs, concurrency, node
**Scope:** packages/cli/**/*.ts, !**/*.test.*

When performing atomic writes using a 'write-then-rename' strategy, include a random suffix (for example, crypto.randomUUID()) in the temporary filename to prevent collisions during concurrent executions; process.pid and/or a timestamp may be added as extra entropy but PID/time-only combinations can still collide.
