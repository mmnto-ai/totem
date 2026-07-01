---
'@mmnto/totem': minor
---

ADR-112 §5.3/§6/§8 Slice D3 — the AUTHORED window-tunnel scorer (`scoreAuthoredWindtunnel`), inert-until-D4.

The sibling scorer that consumes the §6 authored controls (built inert across D1–D2.6) and the window-wide answer key (D2.6) to produce a certifying verdict for an authored rule window. Per strategy's Q1 ruling (2026-07-01) it **reduces to the mined `scoreWindtunnel`, it does not fork it** — a fork would violate the §5.3 content-blind-scorer invariant + §9 one-PASS/FAIL-meaning. The mined cascade is reused byte-unchanged; the authored layer only normalizes the controls into a `ScorerInput`, applies a pre-scorer non-emission gate, and appends a verdict-inert O3 metric.

- **Positive-target projection** — `positiveControlTargets` is derived from `authoredControls.positive[]` (only `differential-holds` fixtures reach that list, discharged at emission), so the mined scorer never re-proves the postimage leg.
- **Non-emission gate** (the load-bearing fold) — a culled differential (empty `positive[]` + a recorded `nonEmissions[]`) can no longer reach the mined scorer as `positiveControlTargets: []` and pass silently. An `illegitimate` non-emission is a Gate-1 FAIL-equivalent; an `undecidable`/`deferred` one is not-certifiable (HONEST-NEGATIVE). The gate is demote-only and per-non-emission (a holding control does not launder an illegitimate sibling). Recorded in an `authoredControlGate` audit field (no silent skip, Tenet-4).
- **O3 metric** (`heldOutActivationsByRule`, verdict-inert) — per authored rule under test, the count of its non-control (`corpus`) firings on held-out PRs. Keys are join-back-derived from the positive controls' `targetRuleId` (Tenet-20; a zero-activation rule still appears — the rare-defect case). Culled rules are excluded. The Gate-2-eligible SET derivation is deferred to D4.

Pure function (no IO/clock/LLM; Tenet-15 deterministic), offline-unit-tested in `@mmnto/core` (14 cases). **Inert** — not wired into any cert run; `spine-windtunnel` stays on the mined scorer until slice D4 flips the authored path reachable (D4 owes the whole-path couple-on-merge: scorer + the no-mint gate + the §6 deriver, end-to-end).
