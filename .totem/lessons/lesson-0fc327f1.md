## Lesson — Guard against self-suppressing patterns

**Tags:** compiler, linting, logic
**Scope:** packages/core/src/compile-lesson.ts

Patterns matching suppression directives (e.g., totem-ignore) must be rejected during compilation. The engine suppresses these lines before evaluation, rendering such rules logically unreachable.
