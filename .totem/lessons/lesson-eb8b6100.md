## Lesson — Ensure byte-stable JSON serialization

**Tags:** json, git
**Scope:** packages/core/src/verification-outcomes.ts

Apply recursive object-key sorting when serializing committable state to prevent non-deterministic property ordering from creating phantom Git diffs.
