---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

**BREAKING (authored envelope):** `dslSource`, `declaredEngine`, and inline fixture `preimageSource` are removed from `.totem/spine/authored-rules.yaml` entries and rejected by name with a migration message; entries reference a `.totem/rules/<slug>.rule.yaml` record instead. No such envelope exists in the cohort; `totem rule author` requires a frozen split artifact.

Adapt the ADR-112 authored producer to the Prop 310 record grammar (slice 3 of the Prop 310 build). The engine is derived from the record's `target.type`, each positive fixture's certification `preimageSource` is derived from `examples[<ordinal>]` under the § Design 10 `(ruleId, ordinal)` key with a CR-blind pair hash, and the authoring-ledger binds the record's content hash. Stage 4 and `totem doctor` read a record rule's exemplars from `examples`, `totem rule test` runs every example pair through the smoke gate, and the compile manifest attests `.totem/rules/**/*.rule.yaml` as `records_hash` (git-tracked files; absent is accepted only while no tracked record exists).
