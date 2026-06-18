// ─── Types ──────────────────────────────────────────

export type WindtunnelVerdictKind = 'PASS' | 'HONEST-NEGATIVE' | 'FAIL';
export type GroundTruthLabel = 'TP' | 'FP';

export interface CullLedgerEntry {
  ruleId: string;
  pr: number;
  filePath: string;
  matchedLine: string;
  reason: 'negative-control-fired';
}

export interface WindtunnelDiagnostics {
  /**
   * Precision (TP/(TP+FP)) over labeled, surviving (non-culled,
   * non-negative-control) firings. DESCRIPTIVE ONLY — informative even on
   * no-claim verdicts ("culled 8/10, the 2 survivors were clean"). NEVER
   * consulted for the gate decision and never mistakable for the certifying
   * `precision`. null when no surviving firing is labeled.
   */
  survivorPrecision: number | null;
}

export interface WindtunnelVerdict {
  verdict: WindtunnelVerdictKind;
  /**
   * Certifying precision claim. A real value ONLY on verdicts that make a
   * precision claim: PASS (1.0) and confirmed-FP FAIL (the breaching value,
   * which IS the evidence). `null` on every no-claim verdict (exposure-floor /
   * cull-rate / needs-adjudication HONEST-NEGATIVE, and vacuous-control FAIL).
   * `null` ⟺ no precision claim; `0` is reserved for a real all-FP measurement
   * and NEVER means "not computed" (#2189 ruling, strategy-claude 2026-06-17).
   */
  precision: number | null;
  mintedRuleCount: number;
  culledCount: number;
  survivingRuleCount: number;
  /** 3-tuple: [activeRulesEvaluated, filesTouchedInWindow, positiveControlsExercised]. Never collapsed to a product. */
  exposureTuple: [number, number, number];
  cullLedger: CullLedgerEntry[];
  /** True when all positive controls fired their target rule. */
  nonVacuity: boolean;
  /** Label ids of firings with no ground-truth label (operator adjudication required). */
  needsAdjudication: string[];
  /** Separately-namespaced descriptive diagnostics — never part of the gate decision. */
  diagnostics: WindtunnelDiagnostics;
}

export interface RuleFiring {
  ruleId: string;
  pr: number;
  filePath: string;
  matchedLine: string;
  controlKind: 'corpus' | 'positive' | 'negative';
  /** For positive controls: the rule that MUST fire to prove non-vacuousness. */
  targetRuleId?: string;
  /** Content-based label id (A2). Compute via firingLabelId from windtunnel-lock. */
  labelId: string;
}

export interface ScorerInput {
  firings: RuleFiring[];
  /** Maps firingLabelId → TP/FP label. Unlabeled firings ⇒ needsAdjudication. */
  groundTruth: Map<string, GroundTruthLabel>;
  positiveControlTargets: Array<{ pr: number; targetRuleId: string }>;
  mintedRuleIds: string[];
  cullRateThreshold: number;
  exposureFloors: {
    activeRulesEvaluated: number;
    filesTouchedInWindow: number;
    positiveControlsExercised: number;
  };
  actualExposure: {
    activeRulesEvaluated: number;
    filesTouchedInWindow: number;
    positiveControlsExercised: number;
  };
}

// ─── Pure scorer ─────────────────────────────────────

/**
 * Score a wind-tunnel run. Pure function: no IO, no clock, no randomness.
 * Implements ADR-110 §4/§5 done-criterion exactly per spec invariants.
 *
 * Verdict ordering (highest precedence first) — #2189 ruling:
 *   1. Any firing labeled FP → FAIL (confirmed FP is a claim; precision = breaching value)
 *   2. Positive control does not fire its target → FAIL (vacuous pass; precision = null)
 *   3. Exposure floor below minimum → HONEST-NEGATIVE (masquerade guard; precision = null)
 *   4. Cull rate exceeds threshold → HONEST-NEGATIVE (cull-laundering guard; precision = null)
 *   5. Any unlabeled firing → HONEST-NEGATIVE (needs adjudication, not PASS; precision = null)
 *   6. All labeled TP → PASS (precision = 1.0)
 *
 * The FAIL tier (1–2) outranks the masquerade guards (3–4): a guard may only
 * DEMOTE a would-be PASS, never UPGRADE a FAIL. survivorPrecision (diagnostics)
 * carries the informative survivor ratio distinct from the certifying precision.
 */
export function scoreWindtunnel(input: ScorerInput): WindtunnelVerdict {
  const {
    firings,
    groundTruth,
    positiveControlTargets,
    mintedRuleIds,
    cullRateThreshold,
    exposureFloors,
    actualExposure,
  } = input;

  const mintedRuleCount = mintedRuleIds.length;
  const cullLedger: CullLedgerEntry[] = [];
  const needsAdjudication: string[] = [];

  // Step 1: Cull rules that fire on negative controls (S2/C5).
  // A rule firing on ANY negative-control item is culled + recorded in
  // cullLedger. Never silently dropped.
  const culledRuleIds = new Set<string>();
  for (const firing of firings) {
    if (firing.controlKind === 'negative') {
      culledRuleIds.add(firing.ruleId);
      cullLedger.push({
        ruleId: firing.ruleId,
        pr: firing.pr,
        filePath: firing.filePath.replace(/\\/g, '/'),
        matchedLine: firing.matchedLine,
        reason: 'negative-control-fired',
      });
    }
  }

  const culledCount = culledRuleIds.size;
  const survivingRuleCount = mintedRuleCount - culledCount;

  // Exposure tuple: always a 3-tuple, never collapsed (spec invariant).
  const exposureTuple: [number, number, number] = [
    actualExposure.activeRulesEvaluated,
    actualExposure.filesTouchedInWindow,
    actualExposure.positiveControlsExercised,
  ];

  // Step 2: Label surviving (non-negative-control, non-culled) firings. Computed
  // BEFORE the masquerade guards because the FAIL tier outranks them (#2189) — we
  // must know hasFp/nonVacuity before deciding whether a guard may short-circuit.
  let hasFp = false;
  let tpCount = 0;
  let labeledCount = 0;
  for (const firing of firings) {
    if (firing.controlKind === 'negative') continue;
    if (culledRuleIds.has(firing.ruleId)) continue;

    const label = groundTruth.get(firing.labelId);
    if (label === undefined) {
      needsAdjudication.push(firing.labelId);
    } else if (label === 'FP') {
      hasFp = true;
      labeledCount++;
    } else {
      tpCount++;
      labeledCount++;
    }
  }

  // survivorPrecision (diagnostic, descriptive): TP/(TP+FP) over labeled surviving
  // firings — informative even on no-claim verdicts, NEVER the gate decision.
  const survivorPrecision = labeledCount > 0 ? tpCount / labeledCount : null;
  const diagnostics: WindtunnelDiagnostics = { survivorPrecision };

  // Step 3: Positive control non-vacuity check. Every positive control target
  // must have its targetRuleId fire on an un-culled rule. A vacuous pass → FAIL.
  let nonVacuity = true;
  for (const target of positiveControlTargets) {
    const fired = firings.some(
      (f) =>
        f.controlKind === 'positive' &&
        f.pr === target.pr &&
        f.ruleId === target.targetRuleId &&
        !culledRuleIds.has(f.ruleId),
    );
    if (!fired) {
      nonVacuity = false;
      break;
    }
  }

  // ── FAIL tier (outranks the masquerade guards, #2189) ──

  // Step 4a: Confirmed FP → FAIL. precision = the breaching value (the evidence,
  // must be reported). A 0 here is a REAL all-FP measurement, never a sentinel.
  // labeledCount ≥ 1 whenever hasFp, so the ratio is always defined.
  if (hasFp) {
    return {
      verdict: 'FAIL',
      precision: tpCount / labeledCount,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity,
      needsAdjudication,
      diagnostics,
    };
  }

  // Step 4b: Vacuous positive control → FAIL. precision = null — a structural
  // failure makes no precision claim (#2189 Q-A); 0 would falsely read as all-FP.
  if (!nonVacuity) {
    return {
      verdict: 'FAIL',
      precision: null,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity: false,
      needsAdjudication,
      diagnostics,
    };
  }

  // ── Masquerade guards (may only DEMOTE a would-be PASS) ──

  // Step 5: Exposure floor (P2). activeRules/positiveControls below floor →
  // HONEST-NEGATIVE (no claim → precision null). Ranked above needs-adjudication
  // (Step 7): labeling won't rescue a sub-floor run (strategy-claude tie-break).
  if (
    actualExposure.activeRulesEvaluated < exposureFloors.activeRulesEvaluated ||
    actualExposure.positiveControlsExercised < exposureFloors.positiveControlsExercised
  ) {
    return {
      verdict: 'HONEST-NEGATIVE',
      precision: null,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity,
      needsAdjudication,
      diagnostics,
    };
  }

  // Step 6: Cull-rate guard (C5/S2). culledCount / mintedRuleCount > threshold →
  // HONEST-NEGATIVE. Guard applies only when mintedRuleCount > 0 (avoids division
  // by zero at the harness phase). No claim → precision null.
  if (mintedRuleCount > 0 && culledCount / mintedRuleCount > cullRateThreshold) {
    return {
      verdict: 'HONEST-NEGATIVE',
      precision: null,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity,
      needsAdjudication,
      diagnostics,
    };
  }

  // Step 7: Unlabeled firings → not PASS (operator must adjudicate first). No
  // claim → precision null.
  if (needsAdjudication.length > 0) {
    return {
      verdict: 'HONEST-NEGATIVE',
      precision: null,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity,
      needsAdjudication,
      diagnostics,
    };
  }

  // Step 8: All firings labeled TP, exposure floors met, positive controls
  // verified → PASS. precision = 1.0 (tpCount === labeledCount here; vacuously
  // 1.0 when no firings — the harness phase).
  return {
    verdict: 'PASS',
    precision: labeledCount > 0 ? tpCount / labeledCount : 1.0,
    mintedRuleCount,
    culledCount,
    survivingRuleCount,
    exposureTuple,
    cullLedger,
    nonVacuity,
    needsAdjudication,
    diagnostics,
  };
}
