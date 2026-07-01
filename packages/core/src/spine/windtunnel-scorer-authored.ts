// ─── ADR-112 §5.3/§6/§8 — the AUTHORED window-tunnel scorer (slice D3) ────────
//
// The sibling scorer for an AUTHORED rule window. Per strategy's Q1 ruling
// (2026-07-01) it REDUCES to the mined `scoreWindtunnel`, it does NOT fork it — a
// fork would violate the §5.3 content-blind-scorer invariant + §9 one-PASS/FAIL-
// meaning (contract-illegal). The mined cascade is reused BYTE-UNCHANGED; this
// layer only (a) normalizes the §6 authored controls into a `ScorerInput`, (b)
// applies a pre-scorer non-emission gate, and (c) appends a verdict-inert O3
// generalization metric.
//
// It is INERT like D1–D2.6: nothing here is wired into a cert run. The CLI
// `spine-windtunnel` command stays on the mined scorer until slice D4 flips the
// authored path reachable (D4 owes the whole-path couple-on-merge — scorer + the
// #793 no-mint gate + the §6 deriver, end-to-end). D3 is the pure inert core,
// offline-unit-tested in `@mmnto/core`.
//
// The three reduction moves (converged 4-seat panel, design in
// `.totem/specs/d3-authored-scorer.md`):
//   1. Positive-target projection: `positiveControlTargets` is DERIVED from
//      `authoredControls.positive[]` — only `differential-holds` fixtures reach
//      that list (discharged at emission in authored-controls.ts), so the mined
//      scorer never re-proves the postimage leg.
//   2. Non-emission gate (codex's load-bearing fold): a culled differential (empty
//      `positive[]` + a recorded `nonEmissions[]`) must NOT reach the mined scorer
//      as `positiveControlTargets: []` and silently PASS. An `illegitimate` class
//      is a Gate-1 FAIL-equivalent; `undecidable`/`deferred` is not-certifiable
//      (HONEST-NEGATIVE). The gate is DEMOTE-ONLY (mirrors the mined "a guard may
//      demote a would-be PASS, never upgrade a FAIL") and PER-non-emission (a
//      holding control on one fixture does not launder an illegitimate sibling).
//   3. O3 metric (verdict-inert post-pass): `heldOutActivationsByRule` — per
//      authored rule under test, the count of its non-control (`corpus`) firings on
//      held-out PRs. Keys are JOIN-BACK-derived from the positive controls'
//      `targetRuleId` (Tenet-20; a firing-only derivation would drop a rule with
//      zero held-out activations — the rare-defect case). Strategy Q2: the metric
//      is NEVER consulted for the verdict, and the Gate-2-eligible SET derivation
//      is DEFERRED to D4 (D3 emits only the raw metric).

import type { AuthoredControls } from './authored-controls.js';
import type { ScorerInput, WindtunnelVerdict, WindtunnelVerdictKind } from './windtunnel-scorer.js';
import { scoreWindtunnel } from './windtunnel-scorer.js';

// ─── Types ──────────────────────────────────────────

/**
 * Input to the authored scorer. Extends the mined `ScorerInput` MINUS
 * `positiveControlTargets` (that field is DERIVED here from `authoredControls`),
 * plus the §6 answer key and the held-out partition for the O3 metric.
 *
 * `firings` carries the MERGED train + held-out firings — a train-side FP fails the
 * whole window (a window-wide verdict), and `heldOutPrs` partitions them for the O3
 * metric only. `exposureFloors` / `actualExposure` pass straight through to the
 * mined scorer: D3 does not recompute exposure (the third leg counts train-side
 * positive controls only — held-out activations never inflate it).
 */
export interface AuthoredScorerInput extends Omit<ScorerInput, 'positiveControlTargets'> {
  /** The §6 answer key from `deriveAuthoredControls` — the emitted positives + the kept non-emissions. */
  authoredControls: Pick<AuthoredControls, 'positive' | 'nonEmissions'>;
  /** Held-out (scored-slice) PR numbers — the O3 partition. Supplied from `split.heldOutPrs` at D4. */
  heldOutPrs: ReadonlySet<number>;
}

/** How the non-emission gate demoted the mined verdict ('none' = the mined verdict already met/exceeded the gate). */
export type AuthoredControlGateEffect =
  | 'none'
  | 'fail-illegitimate'
  | 'honest-negative-not-certifiable';

/**
 * The non-emission gate's audit record — observable so a consumed non-emission is
 * NEVER a silent skip (Tenet-4). The counts report the raw `nonEmissions[]` tally
 * regardless of `effect`; `effect` reports the demotion actually APPLIED to the
 * mined verdict (so a more-severe mined FAIL can coexist with `effect: 'none'`
 * while `illegitimate > 0` — the counts, not `effect`, are the presence signal).
 */
export interface AuthoredControlGate {
  illegitimate: number;
  undecidable: number;
  deferred: number;
  effect: AuthoredControlGateEffect;
}

/** The mined verdict + the two authored additions (both never re-consulted for the verdict). */
export interface AuthoredWindtunnelVerdict extends WindtunnelVerdict {
  /** O3 (verdict-inert): `targetRuleId → held-out non-control activation count`. Join-back keyed. */
  heldOutActivationsByRule: Record<string, number>;
  /** The non-emission gate's audit record (§6 fold). */
  authoredControlGate: AuthoredControlGate;
}

// ─── Verdict-severity ladder (demote-only combination) ───────────────────────

/** PASS < HONEST-NEGATIVE < FAIL. The gate may only raise severity, never lower it. */
const VERDICT_SEVERITY: Record<WindtunnelVerdictKind, number> = {
  PASS: 0,
  'HONEST-NEGATIVE': 1,
  FAIL: 2,
};

// ─── Public API ─────────────────────────────────────

/**
 * Score an AUTHORED wind-tunnel run. Pure function: no IO, no clock, no
 * randomness, byte-identical across re-runs for identical inputs (Tenet-15).
 * Reduces to `scoreWindtunnel` after normalizing the §6 controls, applies the
 * non-emission gate (demote-only), and appends the verdict-inert O3 metric.
 */
export function scoreAuthoredWindtunnel(input: AuthoredScorerInput): AuthoredWindtunnelVerdict {
  const {
    firings,
    groundTruth,
    mintedRuleIds,
    cullRateThreshold,
    exposureFloors,
    actualExposure,
    authoredControls,
    heldOutPrs,
  } = input;

  // Move 1 — project the emitted positives into the mined scorer's target shape.
  // Only `differential-holds` fixtures are in `positive[]`; the mined scorer takes
  // the (pr, targetRuleId) pair and proves non-vacuity by the target firing.
  const positiveControlTargets = authoredControls.positive.map((c) => ({
    pr: c.pr,
    targetRuleId: c.targetRuleId,
  }));

  const mined = scoreWindtunnel({
    firings,
    groundTruth,
    positiveControlTargets,
    mintedRuleIds,
    cullRateThreshold,
    exposureFloors,
    actualExposure,
  });

  // Move 2 — the non-emission gate. Tally the classes, then combine the gate's
  // implied verdict with the mined verdict on the severity ladder (demote-only).
  let illegitimate = 0;
  let undecidable = 0;
  let deferred = 0;
  for (const ne of authoredControls.nonEmissions) {
    if (ne.class === 'illegitimate') illegitimate += 1;
    else if (ne.class === 'undecidable') undecidable += 1;
    else deferred += 1; // 'deferred' — the enum is closed (illegitimate|undecidable|deferred)
  }

  // The gate's implied verdict: an illegitimate control is a Gate-1 FAIL-equivalent
  // (outranks undecidable/deferred); an undecidable/deferred control is not-
  // certifiable → HONEST-NEGATIVE. No blocking non-emission ⇒ no constraint.
  let gateKind: WindtunnelVerdictKind | null = null;
  let gateLabel: Exclude<AuthoredControlGateEffect, 'none'> | null = null;
  if (illegitimate > 0) {
    gateKind = 'FAIL';
    gateLabel = 'fail-illegitimate';
  } else if (undecidable + deferred > 0) {
    gateKind = 'HONEST-NEGATIVE';
    gateLabel = 'honest-negative-not-certifiable';
  }

  // Demote-only: the gate applies ONLY when strictly more severe than the mined
  // verdict. When equal (e.g. an illegitimate non-emission co-occurring with a real
  // FP FAIL), the mined verdict is kept — a structural control defect does not erase
  // a real FP measurement (build-altitude micro-decision, flagged for strategy).
  let verdict: WindtunnelVerdict = mined;
  let effect: AuthoredControlGateEffect = 'none';
  if (gateKind !== null && VERDICT_SEVERITY[gateKind] > VERDICT_SEVERITY[mined.verdict]) {
    // A gate demotion is a structural, no-claim verdict → precision null (#2189):
    // a 0 would falsely read as an all-FP measurement.
    verdict = { ...mined, verdict: gateKind, precision: null };
    effect = gateLabel!;
  }

  // Move 3 — the verdict-inert O3 metric. Keys are the authored rules under test
  // (join-back from the positive controls), minus any culled rule. Values count each
  // rule's non-control (`corpus`) firings on held-out PRs — 0 is a valid observable
  // (the rare-defect case), so a keyed rule always appears even with no activation.
  const culled = new Set(mined.cullLedger.map((e) => e.ruleId));
  const heldOutActivationsByRule: Record<string, number> = {};
  for (const c of authoredControls.positive) {
    if (culled.has(c.targetRuleId)) continue; // (d) cull symmetry — out of the metric AND its keys
    if (!Object.hasOwn(heldOutActivationsByRule, c.targetRuleId)) {
      heldOutActivationsByRule[c.targetRuleId] = 0;
    }
  }
  for (const f of firings) {
    if (f.controlKind !== 'corpus') continue; // (c) a rule's own control firing is excluded
    if (!heldOutPrs.has(f.pr)) continue; // held-out slice only
    if (culled.has(f.ruleId)) continue; // (d) culled rule contributes nothing
    if (!Object.hasOwn(heldOutActivationsByRule, f.ruleId)) continue; // only rules with a positive control
    heldOutActivationsByRule[f.ruleId] += 1;
  }

  return {
    ...verdict,
    heldOutActivationsByRule,
    authoredControlGate: { illegitimate, undecidable, deferred, effect },
  };
}
