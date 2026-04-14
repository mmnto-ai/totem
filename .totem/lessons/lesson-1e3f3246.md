## Lesson — Separate engine failures from user suppressions

**Tags:** architecture, dx
**Scope:** packages/core/src/compiler-schema.ts

Maintain a strict discriminant between 'failure' events (engine errors) and 'suppress' events (user directives) to ensure system health metrics are not diluted by intentional user overrides.
