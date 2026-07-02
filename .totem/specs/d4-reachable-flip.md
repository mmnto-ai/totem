# ADR-112 Slice D4 — the inert→ENFORCED reachable flip (preflight design)

**Status:** PRE-BUILD — panel out (`2026-07-01T2120Z` × 4), build GATED on strategy Q1. No code on the contested seam.
**Base:** origin/main `3d0a177a` (1.88.0). Strategy ADR-112 @ `origin/main 53c9779` (§8 pins through #793).
**Prior slices:** D1 sibling assembler · D2 input binding · D2.5 no-mint verifyOnly gate · D2.6 window answer-key · D3 `scoreAuthoredWindtunnel` (inert core, `3a6048d3`).

## Goal

D4 makes the authored cert path REACHABLE — the first slice that executes the authored producer end-to-end. Three coupled pieces:

1. **Flip the scorer.** Route the authored path to D3's `scoreAuthoredWindtunnel` at the score step (`spine-windtunnel.ts:524`; mined `scoreWindtunnel` unconditional today; producer-kind dispatch home = `resolveCertifyingCorpusProvider` at `:507`).
2. **Derive + emit the Gate-2-eligible set** = `survivors ∩ {rule : heldOutActivationsByRule[rule] > 0}`.
3. **No-mint gate becomes reachable** — the D2.5 `verifyOnly` gate now fires end-to-end (no new gate code; reachability IS the flip).

Whole-path couple-on-merge owed to strategy. Binding carry (D3 couple, pinned `1a80655e`): consumers key on `authoredControlGate.illegitimate` (COUNT), NEVER `.effect`.

## Grounded wiring inputs (confirmed against source)

The authored scorer signature (D3):

```
scoreAuthoredWindtunnel(input: Omit<ScorerInput,'positiveControlTargets'> & {
  authoredControls: Pick<AuthoredControls,'positive'|'nonEmissions'>;  // §6 answer key
  heldOutPrs: ReadonlySet<number>;                                     // O3 partition
}): AuthoredWindtunnelVerdict   // = WindtunnelVerdict + heldOutActivationsByRule + authoredControlGate
```

- **`authoredControls`** — ALREADY surfaced on the corpus: `spine-windtunnel.ts:362` carries `authoredControls?: AuthoredControls` (undefined ⇒ mined ⇒ byte-unchanged). Computed upstream by `deriveAuthoredControls` (`spine-authored-cert-corpus.ts:273`). **D4 threads it; does NOT recompute.**
- **`heldOutPrs`** — `new Set(split.heldOutPrs)` (`split.ts:38`, `heldOutPrs: PrNumber[]`). The split lives in the authored assembly; **WIRING TODO: surface `heldOutPrs` (or the split) to the score step** — today the corpus carries `authoredControls` but not the split. Candidate: add it beside `authoredControls?` on the authored corpus object.
- **`firings`** — `engineResult.firings` (the MERGED train∪held-out window firings; `heldOutPrs` partitions them for the O3 metric only). Pass-through: `exposureFloors` / `actualExposure` unchanged (D3 does not recompute exposure).
- **`positiveControlTargets`** — NOT supplied on the authored path; the scorer DERIVES it from `authoredControls.positive[]` (Omit in the signature).

## Fork-INDEPENDENT: the Gate-2-eligible set deriver (build now; home is Q2)

Survivors are NOT a verdict field — the verdict exposes `survivingRuleCount` (count), `cullLedger[].ruleId` (culled), and the input `mintedRuleIds`. So **survivors = `mintedRuleIds` \ `cullLedger[].ruleId`**. Keys align: `mintedRuleIds` = the authored `ruleId` (C2a `firingLabelId ← ruleId`); `heldOutActivationsByRule` is join-back-keyed on `positive[].targetRuleId` = the same `ruleId`.

```ts
// Falsifier (k): a survivor with ZERO held-out activations is NEVER admitted
// (agy's rare-defect exemption resolved AGAINST at D3). CODEX CORRECTION: D3 records a
// non-culled rule with a valid positive control + zero held-out firings as an EXPLICIT
// `heldOutActivationsByRule[rule] = 0` (the common case), NOT absent-from-map — so the
// guard must handle BOTH explicit-0 and absent identically: `(map[id] ?? 0) > 0`.
export function deriveGate2EligibleSet(input: {
  mintedRuleIds: readonly string[];
  cullLedger: readonly CullLedgerEntry[];
  heldOutActivationsByRule: Readonly<Record<string, number>>;
  authoredControlGate: Pick<AuthoredControlGate, 'illegitimate'>; // Q4 ruling — window-level disqualifier
}): string[] {
  // Q4 (strategy 2318Z): a window with illegitimate > 0 is FAIL-equivalent — NO survivor is
  // Gate-2-eligible, EVEN WHEN effect === 'none' (a co-severe mined FP FAIL masked it, 1a80655e).
  // Disqualify on the COUNT, NEVER on `.effect === 'fail-illegitimate'`.
  if (input.authoredControlGate.illegitimate > 0) return [];
  const culled = new Set(input.cullLedger.map((e) => e.ruleId));
  return input.mintedRuleIds
    .filter((id) => !culled.has(id)) // survivors = minted \ culled
    .filter((id) => (input.heldOutActivationsByRule[id] ?? 0) > 0); // held-out-exercised; NEVER `?? 1`/defaulted-in
}
```

This pure logic is stable regardless of Q1 (seam) / Q2 (emit-or-inert + artifact home). **Held for Q2:** whether the set is EMITTED (report field / Gate-2 ledger) or computed-but-inert, and its home (report vs separate ledger). Unit tests (fork-independent): (a) survivor with held-out>0 → admitted; (b) survivor absent from map → excluded; (c) survivor with explicit 0 → excluded; (d) culled rule with held-out>0 → excluded (not a survivor).

## The contested seam — HELD for strategy Q1

How to route to `scoreAuthoredWindtunnel` WITHOUT opening a second producer-kind home (§8 single-home, gemini `a66a981`/#786):

- **(a) provider-carried scorer** — the `:507` resolver (already reads producerKind) surfaces the authored inputs + selects the scorer; `:524` stays a single unconditional `corpusProvider.score(...)`. My read: preserves the single home.
- **(b) score-step branch** — `if (authored) scoreAuthoredWindtunnel else scoreWindtunnel` at `:524`, argued legal because engineResult is already single-provenance (§7). Note: the corpus ALREADY carries `authoredControls?` (undefined⇒mined), so the branch signal exists on the corpus — Q1 is whether READING it at `:524` is a second home or a legal downstream read.

**Do not build the seam until strategy rules.** Build (a)-shaped scaffolding only if the ruling lands (a).

## No-mint reachability (codex Q2) + the §6 cull invariant (codex Q1)

- **No-mint:** D2.5's `verifyOnly` gate (in `buildAuthoredCertifyingCorpus`/`runRuleAuthor`) fails loud `GATE_INVALID` on `minted`/`revised`. D4 adds NO new gate code — reachability is the flip. Verify `GATE_INVALID` precedes the first scorer call AND any ledger write (first run that actually reaches it).
- **§6 cull (must-not-break):** only `differential-holds` (`authored-controls.ts:69` `EMITTING_OUTCOME`) reaches `positive[]`; postimage-firing controls are culled to `nonEmissions[]` BEFORE `positive[]` (the `differential-holds` gate ~`:373`). D4 feeds the REAL culled `authoredControls` to the scorer for the first time — confirm no path lets an un-culled control reach `positive[]`.

## Test matrix (agy Q1 — refine on reply)

(i) authored HAPPY PATH e2e (fixture-backed real run: corpus → no-mint gate → authored scorer → Gate-2 set), not a mocked scorer · (ii) no-mint FIRES: `minted`/`revised` ⇒ `GATE_INVALID` before score + before ledger write · (iii) Gate-2 EXCLUSION: zero-held-out survivor excluded (falsifier (k)) · (iv) `.illegitimate`-COUNT-not-`.effect` under a co-occurring FP-FAIL · (v) MINED path regression: producerKind absent ⇒ byte-unchanged. Seam altitude (CLI vs core) + fixture reuse pending agy Q2/Q3.

## Open questions held for the panel

- **strategy Q1** — scorer dispatch home (a vs b). GATES the wiring.
- **strategy Q2** — Gate-2 set emit-or-inert + artifact shape/home. GATES the deriver's home.
- **strategy Q3/Q4** — no-mint arming semantics; whole-path couple scope.
- **wiring** — surface `heldOutPrs`/split to the score step; confirm survivors-from-(minted\culled) is the intended source.
- **gemini** — (a)/(b) Tenet-9/20; Gate-2 derivation altitude (scorer vs downstream); flip-last tenet guard.
- **codex** — §6 cull reaches scorer un-broken; GATE_INVALID ordering; absent≡0≡excluded on the COUNT.

## Gate + release (D4 IS releasable)

`pnpm -r build && pnpm test` (full workspace, chained not piped) · `totem lint` · ESLint `pnpm --filter @mmnto/totem lint` (distinct) · prettier CHANGED-only · changeset `@mmnto/totem` minor (fixed group bumps all 5). Preflight w/ short spec slug (this file).

## Fable #697 trial (folds in)

**Candidate CONFIRMED (agy Q4): Row (iii) — Gate-2 exclusion under falsifier (k).** Isolated mathematical boundary (`survivors ∩ {rule : heldOutActivationsByRule[rule] > 0}`); Fable drafts the core unit cases, I verify assertion-strength against the live core reducer + the source contract (not just green), log survived-quality + token/latency to strategy#697. Per my #796 reply, the verify leg = contract-check.

---

## PANEL CONVERGENCE — folded 2026-07-01 (codex 2209Z · gemini 2145Z · agy 2203Z; strategy Q1/Q2 still the GATE)

Three lens seats replied; **strongly convergent**. strategy-claude (contract owner) has NOT ruled — mid-#796 BLIND round; operator nudging. Build stays gated on strategy Q1/Q2.

**Q1 seam — panel PRE-CONVERGED on (a) provider-carried scorer (gemini + codex), pending strategy's formal ruling.**

- gemini: branching at `:524` leaks `producerKind` out of the resolver → violates §8 single-home + Tenet 9. Resolver at `:507` (already knows kind + assembles inputs) bundles the scoring fn; `:524` stays unconditional `corpusProvider.score(...)`.
- codex: keep the flip a CONSUMER of the existing authored corpus surface. **Fail-loud, not fallback:** producerKind `authored` with missing `corpus.authoredControls` must THROW, NEVER fall back to the mined scorer (the one D4-specific way to break the D3 reduction).

**Q2 Gate-2 altitude — UNANIMOUS: downstream deriver, NOT in the scorer (gemini + codex + agy).** Scorer emits raw signal (`heldOutActivationsByRule` + `cullLedger`); the intersection lives at report/consumer altitude (Tenet-20 join-back-once; don't overload the evaluator). The pure `deriveGate2EligibleSet` (above) is that downstream fn. **Still strategy's Q2:** emit-vs-inert + artifact home/shape (report field vs Gate-2 ledger).

**gemini Q3 — flip-last guards to ADD:**

1. **Strict Non-Interference:** assert an absent/`'mined'` producerKind is provably insulated from authored logic/overhead (mined path byte-unchanged) — a regression assertion, not just a byte-diff hope.
2. **Lineage/audit marker:** the Gate-2 emission carries `producerKind: 'authored'` (or equiv) so downstream + post-mortems deterministically trace the derivation path. No silent fallbacks.

**codex — three contract-critical D4 assertions (required):**

1. **§6 cull reaches scorer un-broken:** a D4 test where the differential evaluator returns `fix-shaped` → scorer sees `positive: []`, `nonEmissions[0].class === 'illegitimate'`, and the run must NOT become a mined PASS via `positiveControlTargets: []`.
2. **no-mint ordering (run/provider boundary, not just `runRuleAuthor`):** a stale/first-time authored rule (`minted`/`revised`) → command throws `GATE_INVALID`, a **scorer spy is NOT called**, authoring ledger **byte-unchanged**. (`runRuleAuthor` Pass-1 computes pending writes IO-free; verifyOnly throws before the Pass-2 append loop → precedes first scorer call + any ledger write.)
3. **Gate-2 on the COUNT:** `(count ?? 0) > 0` over survivors — never `effect`, never truthiness/`?? 1`.

**agy — matrix + altitude + fixtures:**

- **+2 rows:** (vi) Cross-partition leakage guard — `split.heldOutPrs ∩ trainPrs = ∅`; a train-only-activating rule → zero held-out → excluded from Gate-2. (vii) Unlabeled-demotion partition — valid positive controls train-side + an unlabeled firing held-out-side → clean `HONEST-NEGATIVE` demotion, no training-signal leak, no FP.
- **Altitude:** Row (i) happy-path e2e → **CLI** (`spine-windtunnel.test.ts`); (ii) no-mint fires → **CLI**; (iii) Gate-2 exclusion → **Core**; (iv) illegitimate-count FP → **Core**; (v) mined regression → **CLI**.
- **Fixtures:** REUSE D3 authored-control + split fixtures for Row (i) (avoid bot-tax); for Row (ii) **dynamically mutate in-memory** (flip a rule to `minted`/`revised`) rather than commit a new static fixture.

**Net build shape (once strategy rules Q1=(a) / Q2):** (1) resolver at `:507` bundles `scoreAuthoredWindtunnel` + threads `authoredControls` (already on corpus) + `heldOutPrs` (new: surface split to score step) → `:524` unconditional `corpusProvider.score(...)`; (2) new core `deriveGate2EligibleSet` (pure, downstream) + its 4 units + the 2 partition rows; (3) fail-loud on missing authored controls; (4) non-interference + lineage-marker guards; (5) the 3 codex assertions; (6) reuse/mutate fixtures per agy. Fable drafts Row (iii).

---

## STRATEGY RULING — 2318Z, ALL FOUR RULED (supersedes the open questions above; build UNBLOCKED)

**Q1 — RULED: single-home EXTENDS to the scorer = (a) provider-carried scorer. My read + panel converged. CONFIRMED.**

- A `producerKind` branch at `:524` is a §8 VIOLATION (a second kind-read; two reads can diverge → score an authored corpus with the mined scorer → silently PASS a culled differential — the codex hole D3 closed). §7 single-provenance of `engineResult` is necessary-not-sufficient (the hazard is provenance-of-_scorer_, not of inputs).
- **Shape:** resolver at `:507` returns a scorer bound at resolution time to the authored substrate. `:524` = unconditional `corpusProvider.score(base)`. Mined ⇒ `(base) => scoreWindtunnel(base)`; authored ⇒ `(base) => scoreAuthoredWindtunnel({ ...base, authoredControls, heldOutPrs })`.
- **THREADING GUARD (contract-relevant):** the authored scorer's `positiveControlTargets` MUST come from `authoredControls.positive` (D3 derives internally at `windtunnel-scorer-authored.ts:122`). Do NOT thread `engineResult.positiveControlTargets` into the authored `.score()` input — double-sourcing reopens the postimage re-proof the D3 reduction discharged. **`base` handed to the authored scorer must EXCLUDE engineResult's positive-target field.**

**Q2 — RULED: EMIT the Gate-2 set, verdict-inert.** A report FIELD sibling to `heldOutActivationsByRule` (co-located; same authored verdict); NOT a separate ledger (avoids a second persisted artifact + its own drift-prone SHA, §8 single-source); never consulted by Gate-1 (§5.3:133 — Gate-2-eligibility only). Set = `survivors ∩ {rule : heldOutActivationsByRule[rule] > 0}`; **falsifier §1(k) enforced AT this derivation**, exclusion OBSERVABLE (don't silently drop). Shape is build-altitude: minimal = eligible rule-id set; richer `Record<ruleId,{heldOutCount,gate2Eligible}>` makes the (k) exclusion legible (shows zero-held-out survivors considered-and-excluded). Contract requires: **emitted · verdict-inert · (k)-guarded · derived-not-mirrored**.

**Q3 — RULED: arming = reachability only, NO new gate code; NO enforce step beyond D2.5's fail-loud.** BUT a one-line §8 **currency pin IS owed** (not a contract change): §8 line 168 says "INERT until Slice D3" — stale; D4 is the flip that arms it → "INERT until Slice **D4**". **Strategy lands it LOCKSTEP with my D4 PR (couple-on-merge, #793 pattern) — no §8 change lands before my build.**

**Q4 — RULED: whole-path couple END-TO-END (4 seams); route the D4 PR to strategy.** Seams strategy reviews: (1) authored corpus resolution (Q1 single-home); (2) the no-mint `verifyOnly` gate FIRING (verifies it executes + fails loud, not just scorer math); (3) `scoreAuthoredWindtunnel` invocation (inputs threaded per Q1 guard); (4) the Gate-2 set emit (verdict-inert, (k)-guarded).

- **`.illegitimate`-count carry RE-AFFIRMED + verified in D3 code → REFINES the Gate-2 deriver (folded above):** a window with `authoredControlGate.illegitimate > 0` is FAIL-equivalent; NO survivor is Gate-2-eligible, **even when `effect === 'none'`** (a co-severe mined FP FAIL masked it). Disqualify on `.illegitimate > 0`, NEVER on `.effect` — a set built off `.effect` silently admits rules from a masked-illegitimate window. (Added the `authoredControlGate` param + the early-`return []` to the deriver sketch above.)

**Currency confirm:** nothing moved on §5.3/§6/§8 since D3 (§8 reads through #793 `135b84a`); strategy's clone = `origin/main 53c9779` (what I re-pulled). Clean.

**All gates cleared. Build to Q1's single-home shape; route the PR to strategy for the 4-seam couple; strategy pins the §8 D3→D4 currency fix lockstep on merge. Fable drafts Row (iii) for #697.**

---

## STEP-2 SEAM — FINALIZED design (grounded in `resolveCertifyingCorpusProvider` + `runCertifyingEngine`)

Facts: `CertifyingCorpusProvider = (lock) => CertifyingCorpus` (a fn); the corpus carries `authoredControls?` but NOT the split. The resolver (`spine-cert-run-corpus.ts:621`) reads `producerKind` (the §8 single home), and for authored already loads the split via `loadAuthoredCertRunFixtures` (⇒ `heldOutPrs` available at resolve). The authored provider (`buildAuthoredCorpusProvider`) ignores the lock and defers to `buildAuthoredCertifyingCorpus` (which runs the no-mint `verifyOnly` gate + derives `authoredControls`). `runCertifyingEngine:1192` calls `corpusProvider(lock)` then returns `EngineResult` (no authoredControls). Score step at `:524` builds a `ScorerInput` `base` from `engineResult`.

**Design — resolver returns a bundle `{ provider, score }`; the scorer is bound at the §8 single home; `:524` unconditional.**

```ts
// Resolved at the ONE home (resolver), off producerKind. mined ⇒ lazy provider + mined score;
// authored ⇒ EAGER-build the corpus once (fires the no-mint gate + derives authoredControls at
// resolve, before engine + score — codex Q2 satisfied EARLIEST), capture the substrate, bind.
type ScoredRun =
  | { kind: 'mined'; verdict: WindtunnelVerdict }
  | { kind: 'authored'; verdict: AuthoredWindtunnelVerdict; gate2: Gate2Eligibility };
interface ResolvedCertifyingRun {
  provider: CertifyingCorpusProvider;
  score: (base: ScorerInput) => ScoredRun;
}

// authored closure (substrate captured at resolve):
score = (base) => {
  const { positiveControlTargets: _drop, ...rest } = base; // Q1 guard: never double-source positives
  const verdict = scoreAuthoredWindtunnel({ ...rest, authoredControls, heldOutPrs });
  const gate2 = deriveGate2Eligibility({ mintedRuleIds: base.mintedRuleIds, verdict }); // downstream of scorer
  return { kind: 'authored', verdict, gate2 };
};
// mined closure: (base) => ({ kind: 'mined', verdict: scoreWindtunnel(base) })  // byte-unchanged
```

- **:524** → `const scored = resolved.score(base)` — UNCONDITIONAL. No second `producerKind` read (the kind is resolved ONCE; `scored.kind` is a derived discriminant carried FROM the single home, Tenet-20 derive-not-mirror — this IS gemini's Q3 lineage marker).
- **Gate-2 emit:** the print/persist step reads `scored.gate2` under `scored.kind === 'authored'` (a discriminant branch on the RESOLVED result, not a lock re-read) → emit as a report field sibling to `heldOutActivationsByRule`.
- **Mined byte-unchanged:** mined provider stays lazy; `scoreWindtunnel(base)` with the full `base` (keeps `positiveControlTargets`). gemini Q3 non-interference: assert absent/'mined' producerKind → `kind:'mined'`, no authored overhead.
- **`heldOutPrs`:** `new Set(split.heldOutPrs)`, captured in the authored closure at resolve (split already loaded there).
- **Caller change (`:507`):** `const { provider, score } = await resolveCertifyingCorpusProvider(...)`; pass `provider` to the engine; use `score` at `:524`. Contained — the resolver has one real run-path caller.
- **Couple flag for strategy:** the authored path EAGER-builds the corpus at resolve (vs lazy at engine-call). Behavior-equivalent for a single run (built once, cached, reused by the engine); moves the no-mint gate firing earlier (still before score + ledger write). Flag in the PR for seam-1/2 review.

---

## D4 COUPLE RESOLUTION — strategy CONDITIONAL PASS (0102Z) → clean bless owed on one row

Strategy's independent-source-read couple verdict on #2285: **4 seams CONFORM** (Q1 single-home, Q3 no-mint firing, Q1 threading guard, Q2/Q4 Gate-2 emit); both build-altitude flags **APPROVED** (eager-build called "better, not just equivalent"). One row OWED before clean bless:

- **Row (viii) — §6 cull-unbroken (codex assertion #1; greptile P2 @ `:492`):** ADDED. A `fix-shaped` differential ⇒ `authoredControls.positive: []` + an `illegitimate` non-emission ⇒ the run FAILs (precision null), `authoredControlGate.illegitimate === 1` / `effect === 'fail-illegitimate'`, `gate2.windowDisqualified`, and CRUCIALLY it does **not** degenerate to a mined PASS via `positiveControlTargets: []`. Core-altitude sibling: `windtunnel-scorer-authored.test.ts` codex-1.

**Bot findings (strategy: my lane, behavior correct, style/perf) — FIXED, not declined (convention-consistency, kills re-review churn):**

- **CR Major (`:19` static import):** the scorers are now dynamic-`import('@mmnto/totem')`ed at the resolver top (the file's own convention; the sync `score` closure closes over the captured refs). Static value import removed.
- **greptile P2 (`:691` dropped lock param):** the authored provider's `_lock: WindtunnelLock` param restored (CertifyingCorpusProvider signature parity + self-documented intentional ignore).

**Build-altitude (b) hardening (strategy non-blocking note) — DEFERRED-WITH-RATIONALE (noted here, not guarded):** an assert that an injected `certifyingCorpus` carries no `authoredControls` would make the mined-only invariant structural vs by-convention. NOT added: the path is production-unreachable (authored flows only through the resolver's eager build), and adding a check to the mined `score` branch would risk the mined-byte-unchanged property this slice guarantees. The by-construction invariant holds; a structural guard is a future defense-in-depth item, not a D4 blocker.

**§8 D3→D4 currency pin:** strategy lands it LOCKSTEP on the operator's named `merge #2285` (#793 pattern, grep-sweeping the whole ADR). Merge is operator-gated.
