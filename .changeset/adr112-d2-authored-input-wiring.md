---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-112 §5/§6/§8 Slice D2 — wire the authored cert-run INPUT path: a lock-level `authored: { judgedBy, expectedSplitRef }` block (additive-optional, reject-unless-authored), an authored fixture-substrate loader (`loadAuthoredCertRunFixtures`, sharing the gate-critical SHA-integrity via the extracted `readAndVerifyScoringSubstrate`), and an async single-home resolver so the caller never branches on `producerKind`. Adds a judgedBy ledger-consistency backstop. Mined path byte-unchanged. Inert/test-lock-only — a production authored run still needs the window-wide label deriver (D2.5, §6). strategy#591/#661.
