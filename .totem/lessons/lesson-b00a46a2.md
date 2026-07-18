## Lesson — Fail closed on corrupt freeze files

**Tags:** compiler, security, error-handling
**Scope:** packages/core/src/freeze.ts

The local freeze-file read must throw an explicit error (such as `TotemConfigError`) upon encountering a corrupt freeze file rather than silently bypassing itself. This ensures that security boundaries and frozen states are strictly enforced without silent failures. The distributed cohort-channel read is the deliberate exception: it never throws and instead degrades to `status: 'corrupt'` with zero visible entries, so every consumer stays conservative (gates keep blocking) — do not "fix" that divergence to match the local fail-closed contract.
