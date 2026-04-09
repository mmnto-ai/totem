## Lesson — Isolate static templates for prompt caching

**Tags:** llm, performance
**Scope:** packages/core/src/compile-lesson.ts

Static instructions must be byte-stable to trigger provider-native caching; dynamic content like telemetry IDs must remain in the user prompt to avoid constant cache invalidation.
