---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(review): `lessonsConsulted` — the round's lesson-recall record on the verdict-artifact contract (mmnto-ai/totem#2363, strategy#474 grounding lever).

Premise correction recorded with the build: lesson recall is ALREADY live on the review-fan path — the fan is dispatched from the standard shield path after `retrieveContext`/`assemblePrompt`, so every lane's prompt carries the lesson checklist and every lane's run artifact carries lesson grounding. What was missing is the CONTRACT line: the verdict artifact had no recall record, so a consumer couldn't read recall status without chasing per-lane run artifacts, and a future runner change could silently drop retrieval without violating any contract.

- Verdict schema 1.1.0 (additive-optional, F1): `lessonsConsulted` — `{ status: 'hit' | 'empty', items: [{ contentHash, filePath, sourceRepo? }] }`, identity-only (mirrors grounding-item semantics, no content bytes). Three observable states: field ABSENT = producer performed no retrieval (pre-1.1 artifacts — honest-absent, never fabricated); `empty` = retrieval ran, zero lessons (the visibly-ungrounded state the strategy#474 abstain-on-empty rule needs to be checkable); `hit` = identities carried. `status` ⟺ `items` enforced in the artifact superRefine (never mirrored on trust).
- One field per VERDICT, not per lane — identical-kit discipline makes recall a round-level fact; per-lane provenance stays one hop away in each lane's run-artifact bundle.
- `deriveLessonsConsulted(bundle)` exported from core (root barrel + `@mmnto/totem/artifacts`): the single home for the bundle→record mapping; the fan derives, never hand-builds.
- The fan now emits the field on every verdict (derived from the same grounding bundle its lanes carry). Lane-blindness key-set structural test updated deliberately (the new key is recall telemetry, not a runner discriminator).

Consumer-impact: verdict-artifact schema (additive-optional field; 1.x readers unaffected, written version 1.0.0 → 1.1.0) + new core exports. Existing artifacts parse unchanged.
