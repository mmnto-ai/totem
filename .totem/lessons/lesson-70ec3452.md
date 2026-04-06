## Lesson — Explicitly enable non-code node processing for telemetry

**Tags:** ast, rule-engine
**Scope:** packages/core/src/rule-engine.ts

Rule engines often skip non-code nodes like comments or strings by default; these must be explicitly processed if telemetry needs to track rule matches in those contexts.
