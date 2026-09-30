## Lesson — Defer pinned harness updates to subsequent versions

**Tags:** testing, ci-cd, governance
**Scope:** operations-local/gate5/mig-harness.mjs

When a validation harness is pinned and shared across multiple active release batches under external controls, do not modify it on active batch branches even to fix valid bugs. Instead, defer harness improvements to a subsequent version to preserve the audit trail and prevent breaking external validation.
