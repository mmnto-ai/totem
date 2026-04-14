## Lesson — Use structural checks for feature-gated hashing

**Tags:** hashing, backward-compatibility
**Scope:** packages/core/src/compile-manifest.ts

When gating deterministic hashing on new features, use structural checks (like checking for specific object keys) rather than substring matching to avoid false positives in the gating logic.
