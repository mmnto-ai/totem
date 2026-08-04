## Lesson — Bounded lock acquisition prevents blocking

**Tags:** lock, concurrency, performance
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

Blocking indefinitely on lock acquisition can cause deterministic timeouts and data loss during long-held operations. Use bounded retry budgets combined with safe lockless fallbacks to ensure critical data is still written.
