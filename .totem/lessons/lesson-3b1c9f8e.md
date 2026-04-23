## Lesson — Use typed reason codes for LLM signals

**Tags:** llm, architecture, zod
**Scope:** packages/core/src/compiler-schema.ts

Use a typed `reasonCode` field in LLM schemas instead of parsing prose sentinels to ensure type-safe and test-deterministic routing of non-compilable items.
