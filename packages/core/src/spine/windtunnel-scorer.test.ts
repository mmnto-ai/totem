import { describe, expect, it } from 'vitest';

import { firingLabelId } from './windtunnel-lock.js';
import type { GroundTruthLabel, RuleFiring, ScorerInput } from './windtunnel-scorer.js';
import { scoreWindtunnel } from './windtunnel-scorer.js';

// ─── Helpers ─────────────────────────────────────────

function makeFiring(
  ruleId: string,
  pr: number,
  controlKind: RuleFiring['controlKind'],
  matchedLine = 'const x = 1;',
  filePath = 'src/foo.ts',
): RuleFiring {
  return {
    ruleId,
    pr,
    filePath,
    matchedLine,
    controlKind,
    labelId: firingLabelId(ruleId, pr, filePath, matchedLine),
  };
}

function baseInput(overrides?: Partial<ScorerInput>): ScorerInput {
  return {
    firings: [],
    groundTruth: new Map(),
    positiveControlTargets: [],
    mintedRuleIds: ['rule-a', 'rule-b'],
    cullRateThreshold: 0.5,
    exposureFloors: {
      activeRulesEvaluated: 2,
      filesTouchedInWindow: 0,
      positiveControlsExercised: 0,
    },
    actualExposure: {
      activeRulesEvaluated: 2,
      filesTouchedInWindow: 5,
      positiveControlsExercised: 1,
    },
    ...overrides,
  };
}

// ─── FP label → FAIL ─────────────────────────────────

describe('FP label → FAIL', () => {
  it('returns FAIL when any firing is labeled FP', () => {
    const firing = makeFiring('rule-a', 1, 'corpus');
    const gt = new Map<string, GroundTruthLabel>([[firing.labelId, 'FP']]);
    const result = scoreWindtunnel(baseInput({ firings: [firing], groundTruth: gt }));
    expect(result.verdict).toBe('FAIL');
    expect(result.precision).toBeLessThan(1);
  });
});

// ─── Non-vacuity → FAIL ──────────────────────────────

describe('positive control does not fire its target rule → FAIL', () => {
  it('returns FAIL when positive control target rule never fires', () => {
    const result = scoreWindtunnel(
      baseInput({
        positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }],
        firings: [],
      }),
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.nonVacuity).toBe(false);
  });

  it('returns PASS when positive control target rule fires', () => {
    const firing = makeFiring('rule-a', 10, 'positive');
    const gt = new Map<string, GroundTruthLabel>([[firing.labelId, 'TP']]);
    const result = scoreWindtunnel(
      baseInput({
        positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }],
        firings: [firing],
        groundTruth: gt,
      }),
    );
    expect(result.verdict).toBe('PASS');
    expect(result.nonVacuity).toBe(true);
  });
});

// ─── Negative control → culled + recorded ────────────

describe('negative control fires → culled and recorded in cullLedger', () => {
  it('culls the rule and records in cullLedger (not silently dropped)', () => {
    const firing = makeFiring('rule-a', 99, 'negative', 'near-miss line');
    const result = scoreWindtunnel(baseInput({ firings: [firing] }));
    expect(result.culledCount).toBe(1);
    expect(result.cullLedger).toHaveLength(1);
    expect(result.cullLedger[0]!.ruleId).toBe('rule-a');
    expect(result.cullLedger[0]!.reason).toBe('negative-control-fired');
  });

  it('does not count a culled rule as a surviving rule', () => {
    const firing = makeFiring('rule-a', 99, 'negative');
    const result = scoreWindtunnel(
      baseInput({ firings: [firing], mintedRuleIds: ['rule-a', 'rule-b'] }),
    );
    expect(result.mintedRuleCount).toBe(2);
    expect(result.culledCount).toBe(1);
    expect(result.survivingRuleCount).toBe(1);
  });
});

// ─── Unlabeled firing → needsAdjudication (not PASS) ─

describe('unlabeled firing → needsAdjudication, not PASS', () => {
  it('returns HONEST-NEGATIVE with firing in needsAdjudication when label is missing', () => {
    const firing = makeFiring('rule-a', 1, 'corpus');
    // No groundTruth entry for this firing
    const result = scoreWindtunnel(baseInput({ firings: [firing], groundTruth: new Map() }));
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.needsAdjudication).toContain(firing.labelId);
  });
});

// ─── Exposure floor trip → HONEST-NEGATIVE (P2) ──────

describe('exposure floor check (P2)', () => {
  it('returns HONEST-NEGATIVE when activeRules < floor', () => {
    const result = scoreWindtunnel(
      baseInput({
        actualExposure: {
          activeRulesEvaluated: 1,
          filesTouchedInWindow: 5,
          positiveControlsExercised: 0,
        },
        exposureFloors: {
          activeRulesEvaluated: 2,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
  });

  it('returns PASS when activeRules exactly equals floor = 2 (P2 equality boundary)', () => {
    const result = scoreWindtunnel(
      baseInput({
        actualExposure: {
          activeRulesEvaluated: 2,
          filesTouchedInWindow: 5,
          positiveControlsExercised: 0,
        },
        exposureFloors: {
          activeRulesEvaluated: 2,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
      }),
    );
    // All firings empty + labeled TP by default → PASS
    expect(result.verdict).toBe('PASS');
  });

  it('returns HONEST-NEGATIVE when activeRules = 1 (below floor 2, P2)', () => {
    const result = scoreWindtunnel(
      baseInput({
        actualExposure: {
          activeRulesEvaluated: 1,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
  });

  it('returns HONEST-NEGATIVE when positiveControls < positiveControlsExercised floor', () => {
    const result = scoreWindtunnel(
      baseInput({
        actualExposure: {
          activeRulesEvaluated: 3,
          filesTouchedInWindow: 5,
          positiveControlsExercised: 0,
        },
        exposureFloors: {
          activeRulesEvaluated: 2,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 2,
        },
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
  });

  it('passes when positiveControls exactly equals floor (P2 equality boundary)', () => {
    const result = scoreWindtunnel(
      baseInput({
        actualExposure: {
          activeRulesEvaluated: 3,
          filesTouchedInWindow: 5,
          positiveControlsExercised: 2,
        },
        exposureFloors: {
          activeRulesEvaluated: 2,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 2,
        },
      }),
    );
    expect(result.verdict).toBe('PASS');
  });
});

// ─── Cull-rate guard → HONEST-NEGATIVE (C5/S2) ───────

describe('cull-rate guard (C5/S2)', () => {
  it('returns HONEST-NEGATIVE when cull rate exceeds threshold', () => {
    // 2 minted, 2 culled → rate = 1.0 > threshold 0.5
    const firingA = makeFiring('rule-a', 99, 'negative');
    const firingB = makeFiring('rule-b', 99, 'negative', 'other line');
    const result = scoreWindtunnel(
      baseInput({
        firings: [firingA, firingB],
        mintedRuleIds: ['rule-a', 'rule-b'],
        cullRateThreshold: 0.5,
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.culledCount).toBe(2);
  });

  it('does not apply cull-rate guard when mintedRuleCount = 0 (harness phase)', () => {
    const result = scoreWindtunnel(
      baseInput({
        mintedRuleIds: [],
        firings: [],
        cullRateThreshold: 0.0,
        // Need actualExposure to pass floor check even with 0 minted
        exposureFloors: {
          activeRulesEvaluated: 0,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
        actualExposure: {
          activeRulesEvaluated: 0,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
      }),
    );
    // No minted rules, no firings → PASS (vacuous but valid for harness)
    expect(result.verdict).toBe('PASS');
  });
});

// ─── exposureTuple is always a 3-tuple (never collapsed) ─

describe('exposureTuple invariant', () => {
  it('emits a 3-tuple, never collapsed to a product', () => {
    const result = scoreWindtunnel(baseInput());
    expect(Array.isArray(result.exposureTuple)).toBe(true);
    expect(result.exposureTuple).toHaveLength(3);
    expect(typeof result.exposureTuple[0]).toBe('number');
    expect(typeof result.exposureTuple[1]).toBe('number');
    expect(typeof result.exposureTuple[2]).toBe('number');
  });
});

// ─── Precision over surviving rules (S2) ─────────────

describe('precision is over surviving rules (S2)', () => {
  it('labels precision as over surviving rules after culling', () => {
    const culled = makeFiring('rule-a', 99, 'negative');
    const tp = makeFiring('rule-b', 1, 'corpus');
    const gt = new Map<string, GroundTruthLabel>([[tp.labelId, 'TP']]);
    const result = scoreWindtunnel(
      baseInput({
        firings: [culled, tp],
        mintedRuleIds: ['rule-a', 'rule-b'],
        groundTruth: gt,
        cullRateThreshold: 0.9,
      }),
    );
    expect(result.verdict).toBe('PASS');
    expect(result.precision).toBe(1.0);
    expect(result.culledCount).toBe(1);
    expect(result.survivingRuleCount).toBe(1);
  });
});

// ─── Mock engine: always-0 fires → FAIL vacuity ──────

describe('OQ2: mock engine coverage', () => {
  it('mock always-0 engine: positive control target never fires → FAIL', () => {
    // Always-0 engine: no firings. Positive control target expects rule-a.
    const result = scoreWindtunnel(
      baseInput({
        firings: [], // always-0: never fires
        positiveControlTargets: [{ pr: 1, targetRuleId: 'rule-a' }],
      }),
    );
    expect(result.verdict).toBe('FAIL');
  });

  it('mock always-1 engine: fires on negative control → culled, possibly HONEST-NEGATIVE', () => {
    // Always-1 engine fires on the negative control
    const negFiring = makeFiring('rule-a', 99, 'negative', 'near-miss');
    const result = scoreWindtunnel(
      baseInput({
        firings: [negFiring],
        mintedRuleIds: ['rule-a'],
        cullRateThreshold: 0.5,
      }),
    );
    // 1 minted, 1 culled → rate = 1.0 > 0.5 → HONEST-NEGATIVE
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.cullLedger).toHaveLength(1);
  });

  it('mock exposure-floor-trip engine → HONEST-NEGATIVE', () => {
    const result = scoreWindtunnel(
      baseInput({
        actualExposure: {
          activeRulesEvaluated: 1,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
        exposureFloors: {
          activeRulesEvaluated: 2,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
  });

  it('mock unlabeled-firing engine → needs-adjudication HONEST-NEGATIVE', () => {
    const firing = makeFiring('rule-a', 5, 'corpus', 'some matched line');
    // No groundTruth labels → unlabeled
    const result = scoreWindtunnel(
      baseInput({
        firings: [firing],
        groundTruth: new Map(),
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.needsAdjudication).toHaveLength(1);
    expect(result.needsAdjudication[0]).toBe(firing.labelId);
  });

  it('mock perfect engine: all TPs, positive control fires, exposure met → PASS', () => {
    const corpusFiring = makeFiring('rule-a', 1, 'corpus', 'pattern match');
    const positiveFiring = makeFiring('rule-a', 10, 'positive', 'target match');
    const gt = new Map<string, GroundTruthLabel>([
      [corpusFiring.labelId, 'TP'],
      [positiveFiring.labelId, 'TP'],
    ]);
    const result = scoreWindtunnel(
      baseInput({
        firings: [corpusFiring, positiveFiring],
        groundTruth: gt,
        positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }],
      }),
    );
    expect(result.verdict).toBe('PASS');
    expect(result.precision).toBe(1.0);
    expect(result.nonVacuity).toBe(true);
  });
});

// ─── Bidirectional parity concept (S1+C1) ────────────

describe('bidirectional parity (S1+C1)', () => {
  it('negative fixture: regex match suppressed in comment must not appear as TP', () => {
    // Simulate a firing that should be FP (comment/string context suppressed in production)
    const firing = makeFiring('rule-a', 1, 'corpus', '// const secret = "abc"');
    const gt = new Map<string, GroundTruthLabel>([[firing.labelId, 'FP']]);
    const result = scoreWindtunnel(baseInput({ firings: [firing], groundTruth: gt }));
    expect(result.verdict).toBe('FAIL');
    expect(result.precision).toBeLessThan(1.0);
  });
});

// ─── Label identity (A2) ─────────────────────────────

describe('content-based firing label id (A2)', () => {
  it('same content → same label id (deterministic)', () => {
    const id1 = firingLabelId('rule-a', 1, 'src/foo.ts', 'const x = 1;');
    const id2 = firingLabelId('rule-a', 1, 'src/foo.ts', 'const x = 1;');
    expect(id1).toBe(id2);
  });

  it('different matched line → different label id (survives line-drift)', () => {
    const id1 = firingLabelId('rule-a', 1, 'src/foo.ts', 'const x = 1;');
    const id2 = firingLabelId('rule-a', 1, 'src/foo.ts', 'const y = 2;');
    expect(id1).not.toBe(id2);
  });
});

// ─── Phase (P1) ──────────────────────────────────────

describe('phase discrimination (P1)', () => {
  it('harness lock emits PASS at harness phase with zero minted rules', () => {
    // Harness phase: mintedRuleCount ≈ 0, exposureFloors allow it
    const result = scoreWindtunnel(
      baseInput({
        mintedRuleIds: [],
        firings: [],
        exposureFloors: {
          activeRulesEvaluated: 0,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
        actualExposure: {
          activeRulesEvaluated: 0,
          filesTouchedInWindow: 0,
          positiveControlsExercised: 0,
        },
      }),
    );
    // Zero rules, zero firings → vacuous PASS (valid for harness)
    expect(result.verdict).toBe('PASS');
    expect(result.mintedRuleCount).toBe(0);
  });
});
