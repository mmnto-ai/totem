## Lesson — Isolate per-item errors in batch processing

**Tags:** patterns, reliability
**Scope:** packages/core/src/first-lint-promote.ts

Wrap individual task execution in try-catch blocks during batch processing to prevent a single failure from aborting the entire operation.
