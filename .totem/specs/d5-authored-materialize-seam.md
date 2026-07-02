# ADR-112 Slice D5 — the authored materialize/freeze seam

**Prior slices:** D1 sibling assembler · D2 input binding · D2.5 no-mint verifyOnly gate · D2.6 window answer-key · D3 `scoreAuthoredWindtunnel` (inert) · D4 reachable flip (`317b1a9f`, scorer armed end-to-end).

**Contract owner ruling:** strategy `2026-07-02T0332Z` (D5 CONTRACT RULED). Boundary FIXED.
**Pre-build panel:** codex CONCERN-foldable · agy CLEAN+row(vii) · gemini CLEAN — all folded below.
**Built on:** totem `origin/main 317b1a9f` (1.88.0) · strategy ADR-112 `1d5bca4` (§8 armed-at-D4).

## The gap (why D5 exists)

D4 armed the authored scorer reachable _on fixtures_, but **no authored lock is producible**: `buildWindtunnelLock` (`cert-corpus-seed.ts:252`) is mined-shaped by construction — no `producerKind`, no `authored` block; those are written only in tests. The armed consumer (`resolveCertifyingCorpusProvider` / `buildAuthoredCertifyingCorpus`, `spine-cert-run-corpus.ts:517/626`) fails loud without them. D5 = a **sibling authored materializer** that emits a real authored lock + window-wide substrate, **fixture-proven** end-to-end so `totem spine windtunnel run` yields an authored verdict + Gate-2-eligible set. Mined path **byte-unchanged**. Real lc Tier-1 set = separate follow-on (NOT D5).

## Design — the sibling authored materializer

**Single kind-resolution** at the `materializeCommand` entry (`spine-cert-materialize.ts:93`): resolve `producerKind ?? 'mined'` once; dispatch to the mined path (byte-unchanged) or a new `materializeAuthored(...)` sibling. No `kind` branch smeared into `deriveCorpus` / `buildWindtunnelLock` / control-writing / floor (codex #5, gemini #1). The pure lock builder takes **additive-optional** `producerKind` + `authored` params — mined omits ⇒ byte-identical (codex #4).

**Authored materialize flow** (`materializeAuthored`):

1. Load the authored seed (corpus/selection/split params: `asOfCommit`, predicate, window, `codePathClassifier`, `cutIndex`). Controls are NOT seed-designated — they derive from the rules.
2. Enumerate PRs off the lc clone → corpus; **resolve + freeze the split**, stamping `frozenAt` (new field, below).
3. **Q2 floor gate** (strategy Q2): `N = trainPrs.length + heldOutPrs.length` (non-excluded window), `heldOut = heldOutPrs.length`; fail-loud `GATE_INVALID` if `heldOut / N < 0.5` (inclusive: `=0.5` passes). Exact ratio = the seed's `cutIndex` (build-choice under the floor), recorded in split.json.
4. Read the effective authoring-ledger (`readAuthoringLedger` + `buildAuthoredIdentityIndex` → last-per-ruleId). Assert all effective entries share ONE `splitRef` ⇒ `authored.expectedSplitRef` (the D1 consumer asserts `entry.splitRef === expectedSplitRef`).
5. **Q3 temporal gate** (strategy Q3.1): `split.frozenAt` precedes every effective `entry.authoredAt`; fail-loud `GATE_INVALID` naming rule + both stamps. **Full ISO timestamp required for certifiable rows** (codex: `authoredAt` accepts date-only → ambiguous "after"; a date-only certifiable row fails loud — agy row(vii)).
6. **Q3 membership gate** (strategy Q3.2): every effective `entry.positiveFixturePrs` ∈ `split.trainPrs`; fail-loud `GATE_INVALID` naming rule + PR + slice.
7. **Freeze-vs-run division (as-built):** materialize does NOT compile or `deriveAuthoredControls` — that is the RUN side (`buildAuthoredCertifyingCorpus` compiles + derives §6 controls at run). Materialize reads the effective ledger's `positiveFixturePrs` for the train-side control dirs, and stamps NO `groundTruthSha` (the authored-aware `derive-labels`, D2.6, stamps it) and NO `llmReplaySha` (no authored LLM stage).
8. **Window-wide substrate** (codex #1/#2, the load-bearing reshape): `pr-diffs.json` over the **non-excluded window `trainPrs ∪ heldOutPrs`** (NOT the mined held-out-only `deriveCorpus` shape), every entry `controlKind:'corpus'` (control _roles_ are the run-derived §6 channel), so train-side controls + window-wide FP scoring (§5.3/§9) have their firing substrate. Control dirs = the ledger's train-side `positiveFixturePrs` diffs (negatives are synthetic near-misses, no PR ⇒ empty dir).
9. Stamp `prDiffsSha` over the on-disk window-wide `pr-diffs.json`.
10. `buildWindtunnelLock({seed, resolvedPrs, integrity, producerKind:'authored', authored:{expectedSplitRef}})` → write lock + split.json (with `frozenAt`) + pr-diffs.json + control dirs.

Detect-never-repair (strategy Q3, gemini #2): a split-frozen-**after**-authoring is a HARD FAIL — the materializer NEVER re-freezes/re-authors (sensor-not-actuator; re-freeze is a human authoring-lane act).

## Schema deltas

- **`split.ts` `SplitArtifactSchema`**: add additive-optional `frozenAt: z.string()` (full ISO-8601 instant, the mechanical freeze stamp §5.1 requires; absent ⇒ mined/legacy, byte-unchanged). `resolveSplit` gains an optional `frozenAt` param, stamped by the authored producer. Gemini Tenet-20: the temporal/membership/denominator facts are **dereferenced from the split artifact**, never recomputed or passed as parallel args.
- **`cert-corpus-seed.ts` `buildWindtunnelLock`**: additive-optional `producerKind?: 'authored'` + `authored?: {expectedSplitRef}` params; conditional-spread onto the lock (absent ⇒ no `key:undefined` survives `canonicalStringify` → byte-identical mined output). The schema already carries these fields (`windtunnel-lock.ts:46/62`).

## Test matrix (extend `spine-authored-cert-corpus.test.ts` — agy #1, NOT a parallel file)

- (i) happy: split frozen-before-authoring + all `positiveFixtures` train → produce authored lock → `run` → authored verdict + Gate-2 set. **verdict-inert** (Gate-2 emits, flips no rule — strategy Q4b).
- (ii) **temporal violation** (`frozenAt` after a rule's `authoredAt`) → HARD FAIL `GATE_INVALID` naming rule + both stamps. **[Fable #697 draft-then-verify candidate — agy nominated: isolated, deterministic, compound-message assertion.]**
- (iii) **membership violation** (a `positiveFixturePr` in held-out) → HARD FAIL naming rule + PR + slice.
- (iv) **both violate** → both surfaced, not short-circuited.
- (v) **Q2 floor** `heldOut/N < 0.5` → `GATE_INVALID` naming the split.
- (vi) **floor boundary** `=0.5` → PASS (inclusive).
- (vii) **malformed/missing timestamp** (date-only or absent `authoredAt`/`frozenAt` on a certifiable row) → fail loud, no fallback-to-now (agy additive guard).
- **mined byte-identical regression**: `canonicalStringify(buildWindtunnelLock(minedBefore), 2)` byte-identical pre/post-D5 (snapshot). Load-bearing §7 no-blast-radius guard.

## Reuse (agy #5)

`resolveSelectionRule` (corpus) · `resolveSplit` (split + cover guards, + `frozenAt`) · `readAuthoringLedger`/`foldEffectiveLedgerEntries` (effective ledger) · `resolvePrGit`/`enumeratePrMetas`/`computeFixtureSha` (git I/O) · `buildWindtunnelLock` (+ optional params) · the D4 `spine-authored-cert-corpus.test.ts` harness.

## Couple + build-altitude flags (to strategy on merge — Q5, #793 pattern)

- **§8 primary** — new couple-on-merge sub-bullet: the producer/materialize seam now _produces_ the `authored:{expectedSplitRef}` lock block. §5.1 — the Q3 mechanical checks at freeze. §6 — the producer _emits_ the controls the deriver reads. §9 IMPLEMENTS (no new row). §5.4 orthogonal.
- **Build-altitude flag (a):** `split.frozenAt` did NOT exist (strategy's Q3 assumed it); D5 adds it additive-optional to `SplitArtifactSchema` (mined omits ⇒ byte-identical) + the full-ISO-timestamp rule for certifiable rows. Confirm this realizes the Q3 mechanical-not-attestational intent.
- **Build-altitude flag (b):** the authored materializer derives controls from the rules/ledger (not seed-designated held-out controls); the seed provides only corpus/selection/split params. The window-wide substrate (train ∪ heldOut) replaces the mined held-out-only shape for the authored producer.
