---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-112 §5/§6/§8 Slice D2 — wire the authored cert-run INPUT path: a lock-level `authored: { expectedSplitRef }` block (additive-optional, `.strict()`, reject-unless-authored), an authored fixture-substrate loader (`loadAuthoredCertRunFixtures`, sharing the gate-critical SHA-integrity via the extracted `readAndVerifyScoringSubstrate`), and an async single-home resolver so the caller never branches on `producerKind`. `judgedBy` is the §8 single source in the authoring-ledger (derived at run time, NOT on the lock — strategy couple-on-D ruling (iii), no Tenet-20 mirror), with an assert-equal backstop; the cert run is author-first (the ledger must pre-exist). Mined path byte-unchanged. Inert/test-lock-only — a production authored run still needs the window-wide label deriver (D2.5, §6). strategy#591/#661.
