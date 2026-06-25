---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(parity): value-equality detector for bot-review-config rows (strategy#738 Slice A)

Adds `detectValueEqualityContract` (core) + a `manifestation: value-equality` route and `valueEqualityFieldsFor` registry (CLI `doctor --parity`), promoting the `bot-review-configs` manifest rows from `attestation` to a present-level mechanical scalar check. Reads a scalar at a dotted path in the consumer's on-disk config (`.coderabbit.yaml` / `.gemini/config.yaml` / `greptile.json`) and compares it — typed (never blanket-stringified), zero-network — against the row's own `expected-value-or-derivation`. Honest-absent taxonomy: file-absent → `skip` (scaffold), path-absent/mismatch → `warn`, unparseable → `unknown`. Adds the `value-equality` rung to the §6(a)2 ladder. The strategy-owned manifest row flip couples to this engine on merge.
