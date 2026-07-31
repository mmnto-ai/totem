## Lesson — Enforce single-use constraints on read

**Tags:** security, validation, ledger
**Scope:** packages/core/src/qbd/**/*.ts

Enforcing consume-on-use constraints solely on the write-side is vulnerable to races and manual file tampering. The read-side scanner must independently validate uniqueness and flag duplicate citations as anomalies.
