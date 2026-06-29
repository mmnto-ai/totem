---
'@mmnto/totem': patch
---

ADR-112 §8/§9 Slice C2a — authored-rule id-unification (`firingLabelId ← ruleId`).

An authored rule's compiled identity (`lessonHash`) now carries its persisted, minted `ruleId` instead of the `dslSource`-derived content hash, threaded from the record through `toCompileFeed` → `compileCandidate` via a new optional `CompileInputCandidate.ruleId`. This makes the wind-tunnel firing key (`firingLabelId` embeds it) and the §6 `controls.positive[].targetRuleId` join stable across a matcher edit — §8 excludes `dslSource` from identity precisely so tightening a matcher never orphans a rule's ground-truth labels or controls.

Authored-only and inert: mined rules are byte-identical (no `ruleId` → the content hash stands), and authored rules remain Gate-1 advisory with no control emission yet (Slice C2b). The compiler fails loud if an authored candidate reaches it without its threaded `ruleId` (a threading regression would silently re-derive a `dslSource`-keyed identity and orphan the rule's controls).
