## Lesson — Stub all accessed dependency methods

**Tags:** architecture, dx
**Scope:** packages/cli/build/shims/lancedb.js

When shimming a heavy dependency for a lite build, stub all methods called by the core (e.g., Index.fts()) to throw clear 'unsupported' errors instead of generic TypeErrors.
