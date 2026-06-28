---
'@mmnto/totem': minor
'@mmnto/cli': patch
---

feat(spine): ADR-112 §4 — preimage-differential source-pluggable (`preimageSource` union)

Reframes the authored-rule fixture's preimage anchor from a fixed commit-pair to a per-fixture **`preimageSource` discriminated union** (strategy#591 / ADR-112 §4, coupling mmnto-ai/totem-strategy#767):

- **`{ kind: 'lesson', lessonRef, badExample, goodExample }` (PRIMARY)** — for **review-caught** repos that fold the fix into the introducing commit, so the defect structurally almost never lands on `main` (lc: 18 `fix(` of 433). The positive control fires on the lesson `badExample` and stays silent on `goodExample`. `lessonRef` is bound to the immutable 16-hex `hashLesson` codomain (never a path or mutable alias — §8 identity discipline).
- **`{ kind: 'commit', preimageCommitSha, mergeCommitSha }` (FALLBACK)** — the prior commit-pair binding, now scoped to **land-then-fix** repos.

`AuthoredFixtureSchema` is the single home (auto-threads to `AuthoredProvenanceRecordSchema` + the YAML-input `AuthoredRuleInput`); the new `PreimageSourceSchema` / `PreimageSource` are exported. Built as `z.discriminatedUnion` with each branch `.strict()`, so a cross-branch key fails loud (FM(d)). The `totem rule author` YAML input contract changes accordingly (authors declare a `preimageSource` instead of flat commit fields); the recursive producer-key scan walks the new union depth.

No data migration is owed — there is no persisted authored-rule set, and the flat schema was never released (it ships first in this same union'd version). The §4 preimage-differential itself (fire-on-preimage / silent-on-postimage) materializes in Slices C/D; this slice is the schema + producer + tests.
