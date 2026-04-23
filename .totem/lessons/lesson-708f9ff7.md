## Lesson — Trust explicit classification over content heuristics

**Tags:** compiler, architecture
**Scope:** packages/core/src/compile-lesson.ts

Routing logic should trust explicit flags like `compilable: true` rather than re-scanning body text for keywords to avoid accidental rejection of valid patterns.
