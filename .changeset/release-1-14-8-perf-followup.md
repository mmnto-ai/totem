---
'@mmnto/totem': patch
---

Perf Follow-up: batch compile upgrades and cwd threading

**Perf / correctness (#1232, #1235):**

- Thread explicit `cwd` through `compileCommand` (#1232). `runSelfHealing(cwd)` was ignoring its own cwd parameter because `compileCommand` read `process.cwd()` directly. Fixed by adding `cwd?: string` to `CompileOptions` and threading it to the call site. Prevents future divergence if doctor gains `--cwd`.
- Batch `--upgrade` hashes in `runSelfHealing` (#1235). Previously N upgrade candidates meant N full config/lessons/rules/metrics load cycles. Now all telemetry prefixes build in one metrics load and `compileCommand({ upgradeBatch, cwd })` runs once. Unresolved batch hashes now throw `UPGRADE_HASH_NOT_FOUND` instead of silently becoming 'noop' and masking compile-prune mutations. CLI `--upgrade <hash>` flow is backwards compatible.

**Governance:**

- Added `.github/pull_request_template.md` enforcing Mechanical Root Cause, Fix Applied, Out of Scope, Tests, and Related Tickets sections. Feeds downstream tooling (changesets, CR/GCA context extraction) with consistent structure.

**Postmerge:** 7 new lessons extracted, 1 rule compiled and archived for over-breadth (upgradeTarget: compound per Proposal 226).
