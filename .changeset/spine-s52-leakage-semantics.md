---
'@mmnto/totem': minor
'@mmnto/cli': patch
---

ADR-112 §5.2 fixture-gate widening to leakage semantics (the #2294-couple ruling, operator option (a) recorded on strategy#810): a `positiveFixtures.pr` is legal iff `∉ heldOutPrs` AND (`∈ trainPrs` OR strictly pre-window by ANCESTRY — `is-ancestor(mergeCommit(pr), cutBoundarySha)`, never PR-number order). Widened at all three homes — the intake gate (`runRuleAuthor`), the pure freeze gate (`checkPositiveFixturesTrainSide` / `assertAuthoredFreezePreconditions`, signature gains the verified set), and the §6 deriver (`deriveAuthoredControls`) — with the ancestry proof derived only at git-holding command boundaries (`verifyPreWindowFixturePrs`) and handed in as data; held-out membership is never overridable by the verified set. The authored materializer also resolves proven pre-window fixture diffs into the control dirs. An empty/absent verified set reproduces the prior strict behavior byte-for-byte (legacy lane unchanged). Unblocks the cert-1 anchor set (all anchors ≤ lc#422, strictly pre-window).
