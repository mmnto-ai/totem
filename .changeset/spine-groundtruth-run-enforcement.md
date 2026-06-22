---
'@mmnto/cli': patch
---

spine: enforce `groundTruthSha` at the certifying run + freeze (#709 5d-iii-ii)

The Gate-1 answer key (`ground-truth-labels.json`) is now integrity-gated end-to-end. `derive-labels` (5d-iii-i) already stamps `controls.integrity.groundTruthSha`; this wires the run-side enforcement: `loadCertRunFixtures` verify-then-parses the answer key on a single read (the certifying run hard-fails on a missing or tampered digest), and `freeze` surfaces a warn-only heads-up (mismatch / declared-but-missing / absent-on-certifying), mirroring the `prDiffsSha` scoring-source gate. The deriver is unaffected — it produces the file (`skipGroundTruth`) and is exempt from the run-path precondition. With this, the certifying run reads the materialized frozen labels (it does not re-derive them) against a verifiable answer key, so the cert run is runnable end-to-end.
