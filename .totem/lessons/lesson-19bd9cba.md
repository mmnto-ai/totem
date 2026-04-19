## Lesson — Ensure all exported entry points receive context

**Tags:** architecture, concurrency
**Scope:** packages/core/src/rule-engine.ts

All exported functions that reach shared state paths must be updated to receive context to ensure complete functional isolation across concurrent runs.
