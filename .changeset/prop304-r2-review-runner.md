---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(review): Prop 304 R2 local review runner (#2106) — opt-in multi-lane review fan via `review.lanes`, Prop 302 verdict artifacts under `.totem/artifacts/verdicts/` (lane-blind, content-addressed, `reviewedState`-honest), fix-delta round chaining with CLI-owned settle/cache predicates and composite scope-selector lineage keys, the `review-loop` distributed skill, the pre-fan/post-fan reviewed-content-hash authorization race fix, and presence-only `skipped-not-gated: true` on qualifying parity-readout rows (spec delta 4, totem-strategy#851).

Consumer-impact: CLI surface — new `review.lanes` config key, `--continues` flag, and `local-lane:` summary line on the fan path; new `review-loop` distributed skill via totem init; new `.totem/artifacts/verdicts/` artifact class; `doctor --parity --json` rows gain `skipped-not-gated`. Single-lane `totem review` behavior is unchanged when `review.lanes` is absent.
