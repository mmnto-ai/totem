---
'@mmnto/totem': minor
---

feat(spine): ADR-112 §6 preimage-differential materializer — slice C1, the inert primitive (strategy#591)

`evaluatePreimageDifferential(rule, fixture)` evaluates the §4 preimage-differential for one authored fixture against a compiled rule, switching on the fixture's declared `preimageSource.kind`. The lesson-anchored source (PRIMARY, for review-caught repos) fires the matcher on `badExample` and asserts silence on `goodExample` through the existing `runSmokeGate` engine entry point (regex + ast-grep, in-memory, no temp file). It reports the raw evidence (`firesOnPreimage`, `silentOnPostimage`, match counts) plus a differential-level `outcome` (`differential-holds` / `fix-shaped` / `over-match` / `vacuous-silent` / `needs-adjudication` / `unsupported-source`) — making visible the over-match escape the wind-tunnel scorer cannot catch on a synthetic exemplar (its positive-control check is fire-on-preimage only). The commit-pair source is a typed deferral to slice C2.

Inert by design: it wires nothing into the cert path, mints no ADR-110 §5 run verdict, and emits no controls (slice C2 consumes it to gate control emission; slice D maps the differential to the §5 terminal vocabulary). `fix-shaped` (fires on the fixed form) is never a charitable pass — the literal Falsifying Metric §1(i).
