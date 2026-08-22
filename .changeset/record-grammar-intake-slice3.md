---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

Adapt the ADR-112 authored producer to the Prop 310 record grammar (slice 3 of the Prop 310 build). An entry in `.totem/spine/authored-rules.yaml` now references its rule as a `.totem/rules/<slug>.rule.yaml` record instead of carrying an inline `dslSource`; the engine is derived from the record's `target.type`, each positive fixture's certification `preimageSource` is derived from `examples[<ordinal>]` under the § Design 10 `(ruleId, ordinal)` key with a CR-blind pair hash, and the authoring-ledger binds the record's content hash. `dslSource`, `declaredEngine`, and an inline `preimageSource` are rejected by name at any depth with a migration message. Stage 4 and `totem doctor` read a record rule's bad examples from `examples`, `totem rule test` runs every example pair through the smoke gate, and the compile manifest attests `.totem/rules/**/*.rule.yaml` as `records_hash` (absent is accepted only while no record exists).
