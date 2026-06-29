---
'@mmnto/totem': minor
---

ADR-112 §3/§6 — `negativeFixtures` are silence-only near-misses (couple-on strategy#770).

A §6 negative control is a one-leg silence assertion, not the positiveFixtures two-leg bad/good `preimageSource` pair (different arity, §6 L142). Migrate `AuthoredProvenanceRecordSchema.negativeFixtures` (and the `totem rule author` YAML input) from the reused `AuthoredFixtureSchema` to a new silence-only `AuthoredNegativeFixtureSchema` — a locus (`filePath` + `matchedSpan`) plus a one-side `NearMissSource` (`{kind:'lesson', example, lessonRef?}` | `{kind:'commit', commitSha}`), with no `pr`, no `contentHash`, and no anti-vacuity pair refine. Strict branches fail loud on a leftover positiveFixtures key (FM(d)). New exports: `NearMissSourceSchema`, `AuthoredNegativeFixtureSchema` (+ types).

Correspondingly drops `negativeFixturePrs` from the authoring-ledger entry and the CLI intake: a silence-only synthetic near-miss has no corpus position, so the §5(2) train-side leakage attestation enumerates `positiveFixturePrs` only (a `kind:'commit'` near-miss's train-side attestation returns with the deferred commit-source fallback). No data migration — no persisted authored-rule set; `negativeFixtures` is optional and unset. Inert: feeds §6 `controls.negative[]` emission in slice C2b.
