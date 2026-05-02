## Lesson — Avoid pinning transient publish states

**Tags:** testing, architecture
**Scope:** packages/pack-rust-architecture/test/structure.test.ts

Structural tests should not pin the private field of a package to allow for future public flips without breaking invariants, as the field is inherently transient.
