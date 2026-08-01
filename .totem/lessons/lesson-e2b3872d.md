## Lesson — Baseline monotonicity on all parsed rows

**Tags:** ledger, validation
**Scope:** packages/core/src/qbd/**/*.ts

Monotonicity checks designed to prevent backdated appends must establish their baseline from all parsed rows rather than a filtered subset, preventing bypasses on fresh adoptions.
