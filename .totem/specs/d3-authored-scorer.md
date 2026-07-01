# ADR-112 Slice D3 — the authored window-tunnel scorer (`scoreAuthoredWindtunnel`)

**Status:** design pinned by the converged 4-seat pre-build panel (strategy 0754Z / codex 0821Z /
agy 0840Z / gemini 0910Z, 2026-07-01). Build-inert, offline-unit-tested in `@mmnto/core`. NO CLI
wiring — `spine-windtunnel.ts` stays on the mined scorer until D4 flips the authored path reachable.

## What it is

The sibling scorer that consumes the §6 authored controls (built inert across D1–D2.6) and the
window-wide answer key (D2.6) to produce a certifying verdict for an **authored** rule window. Per
strategy's Q1 ruling it **REDUCES to the mined `scoreWindtunnel`, never forks it** (a fork violates
the §5.3 content-blind-scorer invariant + §9 one-PASS/FAIL-meaning — contract-illegal). The mined
cascade is reused **byte-unchanged**; the authored layer only (a) normalizes its inputs into a
`ScorerInput`, (b) applies a pre-scorer non-emission gate, and (c) appends a verdict-inert O3 metric.

## Reduction (the three moves)

1. **Positive-target projection.** `positiveControlTargets` for the mined scorer is DERIVED from
   `authoredControls.positive[]` — project `{ pr, targetRuleId }`. Only `differential-holds`
   fixtures reach `positive[]` (discharged at emission in `authored-controls.ts:373`), so the mined
   scorer does NOT re-prove the postimage leg.

2. **Non-emission gate (codex's load-bearing fold).** A culled differential (empty `positive[]` +
   a recorded `nonEmissions[]` entry) must NOT reach the mined scorer as `positiveControlTargets: []`
   and silently PASS. Consume `authoredControls.nonEmissions[]` BEFORE trusting the mined verdict:
   - `class:'illegitimate'` (fix-shaped / over-match / vacuous-silent) → **Gate-1 FAIL-equivalent**.
     The control is not a legitimate control; the window is not certifiable → **FAIL**.
   - `class:'undecidable'` / `'deferred'` → **not-certifiable** → **HONEST-NEGATIVE**. Never a
     silent skip (Tenet-4).
   - The gate is **demote-only** (mirrors the mined scorer's "a guard may DEMOTE a would-be PASS,
     never UPGRADE a FAIL"): it can only worsen the mined verdict, never improve it.
   - **Per-non-emission, not per-empty-list** (codex's mixed case): a rule with one emitted (holding)
     positive control AND one illegitimate non-emission still FAILs — the illegitimate entry must
     not vanish behind the emitted control's global non-vacuity.

3. **O3 held-out-activation metric (verdict-inert post-pass).** Emit
   `heldOutActivationsByRule: Record<targetRuleId, count>` — per authored rule under test, the count
   of its **non-control** (`controlKind === 'corpus'`) firings on **held-out** PRs. Keys are
   **join-back-derived** from `authoredControls.positive[].targetRuleId` (Tenet-20 — never inlined
   from the firings; a firing-only derivation would silently drop a rule with zero held-out
   activations, the rare-defect case). **Culled** rules (fired a negative control) are excluded from
   the metric AND its keys. Strategy Q2: this metric is **verdict-inert** — never consulted for the
   verdict, and D3 emits ONLY the raw metric. The **Gate-2-eligible SET derivation is DEFERRED to
   D4** (gemini report-shape ruling + strategy Q2) — no set at D3 means no set to wrongly admit a
   zero-held-out rule into (sidesteps agy's §1(k) conflict).

## Input / output

```ts
// Omit positiveControlTargets — it is DERIVED from authoredControls.positive.
export interface AuthoredScorerInput extends Omit<ScorerInput, 'positiveControlTargets'> {
  /** The §6 answer key from deriveAuthoredControls (positive + the kept non-emissions). */
  authoredControls: Pick<AuthoredControls, 'positive' | 'nonEmissions'>;
  /** Held-out (scored-slice) PR numbers — the O3 partition. From split.heldOutPrs at D4. */
  heldOutPrs: ReadonlySet<number>;
}

export interface AuthoredWindtunnelVerdict extends WindtunnelVerdict {
  /** O3 (verdict-inert): targetRuleId → held-out non-control activation count. Join-back keyed. */
  heldOutActivationsByRule: Record<string, number>;
  /** Audit trail for the non-emission gate — observable, never re-consulted (Tenet-4, no silent skip). */
  authoredControlGate: {
    illegitimate: number;
    undecidable: number;
    deferred: number;
    effect: 'none' | 'fail-illegitimate' | 'honest-negative-not-certifiable';
  };
}
```

`firings` carries the MERGED train + held-out firings (train FP → window-wide FAIL, test (b));
`heldOutPrs` partitions them for the O3 metric only. `exposureFloors` / `actualExposure` are passed
straight through — D3 does not recompute exposure (train-side positive controls only; test (g)).

## Verdict precedence (combining the mined verdict with the gate)

From strongest, the effective verdict is:

1. A real **FP FAIL** from the mined scorer (`verdict === 'FAIL'`, `precision !== null`) — the FP is a
   real defect measurement; keep FAIL and keep the breaching precision (evidence).
2. **illegitimate** non-emission present → **FAIL** (`precision: null`, `effect: 'fail-illegitimate'`).
3. A structural **FAIL** from the mined scorer (vacuous positive control) — FAIL, precision null.
4. **undecidable/deferred** non-emission present (no illegitimate, mined verdict not FAIL) →
   **HONEST-NEGATIVE** (`precision: null`, `effect: 'honest-negative-not-certifiable'`).
5. Otherwise the mined verdict passes through unchanged (`effect: 'none'`).

### Build-altitude micro-decision to flag for strategy (couple-on-merge)

When an **illegitimate non-emission co-occurs with a real FP FAIL** (tier 1 vs tier 2 both apply):
this design keeps the FP's breaching precision (a real measurement survives a structural control
defect — the FP is evidence about OTHER rules' firings, independent of the bad control). The
alternative (null the precision because the certification apparatus is compromised) is defensible
too. Both FAIL; only `precision` differs. Chosen: **keep the FP precision.** Flag this as a
build-altitude sub-decision in the PR + couple-on-merge — strategy owns the §5.3/§9 precision-claim
semantics and may rule the other way (a one-line flip if so).

## Test matrix (agy (a)–(g) + codex ×2)

- (a) rare-defect: valid train positive control fires → PASS, `heldOutActivationsByRule[rule] === 0`
  (present with 0 — join-back key, NO Gate-2 exemption; the set defers to D4).
- (b) train-slice FP → window-wide FAIL.
- (c) a rule's own control firing (`controlKind !== 'corpus'`) is EXCLUDED from the held-out count.
- (d) cull symmetry: a rule that fired a negative control is out of `heldOutActivationsByRule` (and
  its keys) even with otherwise-valid held-out firings.
- (e) window-wide unlabeled firing → HONEST-NEGATIVE (mined `needsAdjudication`).
- (f) FP FAIL outranks generalization: a heavily-generalizing rule with an FP still FAILs; metric
  stays inert.
- (g) exposure counts train-side controls only — held-out activations do NOT inflate
  `positiveControlsExercised`.
- (codex-1) all-positives-non-emission (illegitimate) + no ordinary FP must NOT be PASS → FAIL.
- (codex-2) mixed emitted + illegitimate: the illegitimate must not vanish behind the emitted
  control's non-vacuity → FAIL.

## Non-goals (held to D4)

- Wiring `spine-windtunnel.ts` to the authored scorer (the inert→enforced flip; owes the whole-path
  couple-on-merge — scorer + #793 no-mint gate + §6 deriver end-to-end).
- Deriving the Gate-2-eligible SET (survivors ∩ held-out-exercised).
- Any git / IO / clock / LLM — the scorer is a pure function (Tenet-15 deterministic).
