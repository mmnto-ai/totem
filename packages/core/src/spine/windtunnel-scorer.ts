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

export interface WindtunnelVerdict {
  verdict: WindtunnelVerdictKind;
  /** Precision over surviving rules (after cull). */
  precision: number;
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
 * Verdict ordering (highest precedence first):
 *   1. Exposure floor below minimum → HONEST-NEGATIVE (masquerade guard)
 *   2. Cull rate exceeds threshold → HONEST-NEGATIVE (cull-laundering guard)
 *   3. Positive control does not fire its target → FAIL (vacuous pass)
 *   4. Any firing labeled FP → FAIL (precision < 1.0)
 *   5. Any unlabeled firing → HONEST-NEGATIVE (needs adjudication, not PASS)
 *   6. All labeled TP → PASS
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

  // Step 2: Exposure floor check (P2).
  // activeRules < floor or positiveControls < floor → HONEST-NEGATIVE.
  if (
    actualExposure.activeRulesEvaluated < exposureFloors.activeRulesEvaluated ||
    actualExposure.positiveControlsExercised < exposureFloors.positiveControlsExercised
  ) {
    return {
      verdict: 'HONEST-NEGATIVE',
      precision: 0,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity: false,
      needsAdjudication,
    };
  }

  // Step 3: Cull-rate guard (C5/S2).
  // culledCount / mintedRuleCount > threshold → HONEST-NEGATIVE.
  // Guard applies only when mintedRuleCount > 0 (avoids division by zero at
  // harness phase where mintedRuleCount ≈ 0).
  if (mintedRuleCount > 0 && culledCount / mintedRuleCount > cullRateThreshold) {
    return {
      verdict: 'HONEST-NEGATIVE',
      // precision is NOT computed here (this returns before FP/TP adjudication
      // at Step 5), so report the same "not-computed" sentinel the exposure-floor
      // HONEST-NEGATIVE path uses (0) — never a survival ratio mislabeled as
      // precision. Whether a HONEST-NEGATIVE should instead carry the real
      // precision-over-survivors is a §4/§5 contract question deferred to #2189.
      precision: 0,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity: false,
      needsAdjudication,
    };
  }

  // Step 4: Positive control non-vacuity check.
  // Every positive control target must have its targetRuleId fire on an
  // uncalled rule (not culled). A vacuous pass (rule never fires) → FAIL.
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

  if (!nonVacuity) {
    return {
      verdict: 'FAIL',
      precision: 0,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity: false,
      needsAdjudication,
    };
  }

  // Step 5: Check FP labels and collect unlabeled firings.
  // Scope: non-negative-control, non-culled firings only.
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

  // FP → FAIL (precision < 1.0; zero-confirmed-FP floor violated)
  if (hasFp) {
    const precision = labeledCount > 0 ? tpCount / labeledCount : 0;
    return {
      verdict: 'FAIL',
      precision,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity: true,
      needsAdjudication,
    };
  }

  // Unlabeled firings → not PASS (operator must adjudicate first)
  if (needsAdjudication.length > 0) {
    const precision = labeledCount > 0 ? tpCount / labeledCount : 1.0;
    return {
      verdict: 'HONEST-NEGATIVE',
      precision,
      mintedRuleCount,
      culledCount,
      survivingRuleCount,
      exposureTuple,
      cullLedger,
      nonVacuity: true,
      needsAdjudication,
    };
  }

  // All firings labeled TP, exposure floors met, positive controls verified → PASS
  const precision = labeledCount > 0 ? tpCount / labeledCount : 1.0;
  return {
    verdict: 'PASS',
    precision,
    mintedRuleCount,
    culledCount,
    survivingRuleCount,
    exposureTuple,
    cullLedger,
    nonVacuity: true,
    needsAdjudication: [],
  };
}
