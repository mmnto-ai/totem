## Lesson — Isolate tests modifying module-level state

**Tags:** testing, global-state
**Scope:** packages/mcp/src/**/*.ts, !**/*.test.*

Avoid ordering dependencies in tests by exporting test-only reset utilities for any module-level global variables. Invoking these resets in test teardowns ensures test isolation and prevents failures when tests are shuffled or run in parallel.
