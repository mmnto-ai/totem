## Lesson — Design additive schema updates for reader tolerance

**Tags:** schema, compatibility, serialization
**Scope:** packages/core/**/*.ts, !**/*.test.*

When widening enums or adding metadata to serialized artifacts, make changes purely additive and optional to ensure older readers can parse new formats without breaking.
