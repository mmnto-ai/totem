---
'@mmnto/totem': minor
---

feat(spine): Gate-1 ground-truth label deriver (strategy#709 5d)

Produces `ground-truth-labels.json` — the cert run's disposition-derived ANSWER KEY (`firingLabelId → TP|FP`) — completing the Gate-1 label deriver. With it the certifying run is executable end-to-end. Cohort-panel-ratified (codex/agy/gemini, distinct lenses) before any code. Ships the full 5d arc as one release (5d-i/5d-ii landed changeset-deferred):

- **5d-i** — closed disposition taxonomy classifier (`classifyDisposition` / `dispositionToLabel`): `accepted-fix → TP`, `declined-as-false-positive → FP`; every other class (scope / defer / superseded / style / ambiguous) → UNLABELED (omitted, so the scorer routes the firing to `needsAdjudication`).
- **5d-ii** — held-out disposition source + `controls.integrity.corpusDispositionsSha` (`totem spine windtunnel fetch-dispositions`): freezes the corpus PRs' span-anchored review threads as the answer-key provenance.
- **5d-iii** — the deriver: `deriveLabelsFromDispositions` (pure core span-join) + `totem spine windtunnel derive-labels`. A corpus firing binds to a disposition on the same PR by **added-line content** — the firing's normalized `matchedLine` must equal an ADDED (`+`) hunk row (context/removed rows and file headers ineligible; never physical-line equality); 0-or-multiple matches omit (ambiguity never labels). Positive controls label TP only for the declared `(pr, targetRuleId)` target; incidental non-target firings are omitted and reported; negatives never label. The deriver hard-gates `corpusDispositionsSha` before deriving and stamps `controls.integrity.groundTruthSha` over the emitted answer key (the run-side verify + freeze-warn land in the 5d-iii-ii fast-follow, mirroring the producer → enforcement split).

Firings are enumerated through a shared certifying firing-setup (`buildCertifyingFirings`) + corpus-assembly path (`assembleCertifyingCorpus`, `buildGate1Stage4Deps`) that the certifying run also calls, so the answer-key labelIds match the run's `buildFirings` labelIds byte-for-byte — the drift surface the panel flagged, locked by an equivalence test.
