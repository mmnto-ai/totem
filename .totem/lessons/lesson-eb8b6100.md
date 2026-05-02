## Lesson — Ensure byte-stable JSON serialization

**Tags:** json, git
**Scope:** packages/core/src/**/*.ts

Apply recursive object-key sorting when serializing committable state to prevent non-deterministic property ordering from creating phantom Git diffs. This is a substrate-level discipline that should apply to all committable JSON state in the engine, not just the file that surfaced it — `canonicalStringify(value, indent)` in `compile-manifest.ts` is the canonical primitive.
