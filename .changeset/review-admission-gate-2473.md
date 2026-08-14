---
'@mmnto/cli': minor
---

fix(review): deterministic skips are admission verdicts — disposition record + `--gate` mapping, and the clean-tree stamp is removed (mmnto-ai/totem#2473)

**Admission phase (ruled 2026-08-12):** `totem review` now decides applicability before any lane is configured. A diff that resolves to nothing reviewable — `no-diff`, `all-non-code`, `filtered-empty`, `all-generated` — is a `not-applicable` ADMISSION verdict, never a lane outcome: one calm info-level disposition line, one machine-readable admission record in `.totem/artifacts/admissions/` (content-addressed; binds the resolved diff scope, the diff-bytes hash, and a fingerprint of the effective selection policy), exit `0`. Bare `totem review` keeps the sensor exit-0 default on every known skip — no stale `|| exit 1` hook starts blocking docs-only pushes.

**Behavior change — the clean-tree "trivial pass" no longer stamps.** Previously a no-changes run refreshed `.reviewed-content-hash`, minting push authorization for a tree no reviewer saw. No deterministic skip stamps now. This only reaches consumers running THIS CLI version; a pre-#2180 stamp-consuming hook that misses the refresh re-runs review and lands in the skip path at exit 0 — worst case a redundant pass, never a block.

**New `--gate` flag — the wiring's declared disposition→exit mapping** (ADR-109's wrapper role: the CLI states verdicts, the flag maps them — the sensor default grows no teeth). Known not-applicable admissions and completed rounds exit 0 (findings are report-only in hook context per mmnto-ai/totem#2551), hard failures exit non-zero, an unknown disposition fails CLOSED. Contradictory with `--fail-on`. The managed pre-push hook template regenerates to `review --gate` behind a `--help` probe (older CLIs fall back to the bare form with a visible compat line); the fleet picks it up via `totem init` / `totem hook install`.

**`--covariate` is admission-aware:** a not-applicable current state resolves the exact-identity admission record (deterministic — never wall-clock arbitration across record families) and renders `local-lane: not-applicable (<reason>) recorded=<hash8> at=<createdAt>`. Under content-address dedup a repeat identical skip renders the FIRST observation's `at=` timestamp — that is the record's own truth, not staleness of the check.

**Resolver contract:** `getDiffForReview` now returns a discriminated `DiffForReviewEmpty` (carrying the resolved scope) instead of `null` on a no-changes resolution — programmatic consumers narrow with `'empty' in result`.
