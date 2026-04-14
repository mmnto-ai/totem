## Lesson — Validate plain JSON values for hashing

**Tags:** json, hashing
**Scope:** packages/core/src/compile-manifest.ts

Canonical serialization for hashing must strictly validate that inputs are plain JSON types to prevent non-deterministic output from complex objects like Dates or class instances.
