---
'@mmnto/totem': minor
'@mmnto/cli': patch
---

ADR-112 authored exercised/non-vacuity semantics — option (i) (operator ruling 2026-07-04, #2291): on the authored path, `positiveControlsExercised` is the §6 emission channel (`|authoredControls.positive|` — the §4 preimage-differential at emission IS the exercise proof), and the per-rule C1 positive-control verdict is differential-held-at-emission (`computeAuthoredPerRuleControlResults`, threaded from the §8 resolver through `ScoredRun` into persist) — never fire-on-window-diff, which is structurally unsatisfiable for strictly pre-window anchors (§5.2). Fixes the pre-existing authored-path double-fault: the mined-channel exercised count was structurally 0 (floor ⇒ permanent HONEST-NEGATIVE) and the projected targets could never fire (⇒ vacuous-positive FAIL). The mined lane is byte-unchanged; `verdict.nonVacuity` reads vacuously true on authored verdicts (the authored vacuity guards are the non-emission gate + the exercised floor).
