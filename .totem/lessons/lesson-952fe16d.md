## Lesson — Throw on undefined in canonical serialization

**Tags:** json, hashing
**Scope:** packages/core/src/compile-manifest.ts

Canonical stringification should throw on undefined to prevent silent data drift in hashing pipelines, adhering to the 'Fail Loud' architectural principle.
