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
    // precision is the NULL not-computed sentinel on a no-claim verdict (#2189
    // ruling) — NEVER 0 (a real all-FP value) and NEVER a survival ratio. Locks
    // the greptile-P1 / CR fix + the strategy-claude 2026-06-17 sentinel ruling.
    expect(result.precision).toBeNull();
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

// ─── #2189 ruling: FAIL outranks the masquerade guards ──
//
// strategy-claude verdict-semantics RULING (2026-06-17): a confirmed FP — or a
// vacuous positive control — is a *claim*, not a no-claim. It must FAIL even
// when an exposure-floor / cull-rate masquerade guard would otherwise return
// HONEST-NEGATIVE. The guards may only DEMOTE a would-be PASS; they may never
// UPGRADE a FAIL. Under the pre-#2189 order these returned HONEST-NEGATIVE.

describe('#2189: FAIL precedence outranks the masquerade guards', () => {
  it('unconditionally evaluates to FAIL when a firing is labeled FP, ignoring a sub-floor exposure', () => {
    const fp = makeFiring('rule-a', 1, 'corpus', '// const secret = "x"');
    const gt = new Map<string, GroundTruthLabel>([[fp.labelId, 'FP']]);
    const result = scoreWindtunnel(
      baseInput({
        firings: [fp],
        groundTruth: gt,
        // sub-floor exposure that WOULD trip HONEST-NEGATIVE first under the old order
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
    expect(result.verdict).toBe('FAIL');
  });

  it('evaluates to FAIL when a firing is labeled FP, ignoring an over-threshold cull rate', () => {
    // rule-a culled on a negative control (1/2 = 0.5 > threshold 0.4 → cull-rate HN
    // under the old order); rule-b (surviving) fires a confirmed FP → must FAIL.
    const culled = makeFiring('rule-a', 99, 'negative');
    const fp = makeFiring('rule-b', 1, 'corpus', 'fp line');
    const gt = new Map<string, GroundTruthLabel>([[fp.labelId, 'FP']]);
    const result = scoreWindtunnel(
      baseInput({
        firings: [culled, fp],
        mintedRuleIds: ['rule-a', 'rule-b'],
        groundTruth: gt,
        cullRateThreshold: 0.4,
      }),
    );
    expect(result.verdict).toBe('FAIL');
  });

  it('evaluates to FAIL on a vacuous positive control even under a sub-floor exposure', () => {
    const result = scoreWindtunnel(
      baseInput({
        positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }],
        firings: [], // target never fires → vacuous
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
    expect(result.verdict).toBe('FAIL');
    expect(result.nonVacuity).toBe(false);
  });
});

// ─── #2189 ruling: precision is a null no-claim sentinel ─
//
// precision carries a real value ONLY on verdicts that make a precision claim —
// PASS (1.0) and confirmed-FP FAIL (the breaching value, which IS the evidence).
// On every no-claim verdict it is null — NEVER 0 (a real all-FP value).

describe('#2189: precision null-sentinel on no-claim verdicts', () => {
  it('precision is null on an exposure-floor HONEST-NEGATIVE', () => {
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
    expect(result.precision).toBeNull();
  });

  it('precision is null on a needs-adjudication HONEST-NEGATIVE', () => {
    const firing = makeFiring('rule-a', 1, 'corpus');
    const result = scoreWindtunnel(baseInput({ firings: [firing], groundTruth: new Map() }));
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.needsAdjudication).toContain(firing.labelId);
    expect(result.precision).toBeNull();
  });

  it('precision is null on a vacuous-control FAIL (structural failure, no precision claim — Q-A)', () => {
    const result = scoreWindtunnel(
      baseInput({ positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }], firings: [] }),
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.precision).toBeNull();
  });

  it('precision is a real value on PASS (1.0) and on FP-FAIL (the breaching value, never null)', () => {
    const tp = makeFiring('rule-a', 1, 'corpus');
    const pass = scoreWindtunnel(
      baseInput({ firings: [tp], groundTruth: new Map([[tp.labelId, 'TP']]) }),
    );
    expect(pass.verdict).toBe('PASS');
    expect(pass.precision).toBe(1.0);

    // 1 FP + 1 TP → breaching precision 0.5, a real number (the evidence)
    const fp = makeFiring('rule-a', 2, 'corpus', 'fp');
    const tp2 = makeFiring('rule-b', 3, 'corpus', 'tp');
    const fail = scoreWindtunnel(
      baseInput({
        firings: [fp, tp2],
        groundTruth: new Map([
          [fp.labelId, 'FP'],
          [tp2.labelId, 'TP'],
        ]),
      }),
    );
    expect(fail.verdict).toBe('FAIL');
    expect(fail.precision).toBe(0.5);
  });
});

// ─── #2189 ruling: diagnostics.survivorPrecision is separate ─
//
// CR's survivor-precision is informative ("culled 8/10, the 2 survivors were
// clean") but must NOT live on the certifying field. It is descriptive and
// distinct from `precision`.

describe('#2189: diagnostics.survivorPrecision is a separate descriptive field', () => {
  it('carries the survivor ratio on a HONEST-NEGATIVE while certifying precision stays null', () => {
    // Cull rule-a (over-threshold cull rate), survivor rule-b fires clean TP →
    // survivor ratio 1.0, but the verdict is a no-claim HONEST-NEGATIVE so the
    // certifying precision is null.
    const culled = makeFiring('rule-a', 99, 'negative');
    const survivorTp = makeFiring('rule-b', 1, 'corpus', 'clean');
    const result = scoreWindtunnel(
      baseInput({
        firings: [culled, survivorTp],
        mintedRuleIds: ['rule-a', 'rule-b'],
        groundTruth: new Map<string, GroundTruthLabel>([[survivorTp.labelId, 'TP']]),
        cullRateThreshold: 0.4, // 1/2 = 0.5 > 0.4 → cull-rate HONEST-NEGATIVE
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.precision).toBeNull();
    expect(result.diagnostics.survivorPrecision).toBe(1.0);
  });

  it('survivorPrecision is null when no surviving firing is labeled', () => {
    const result = scoreWindtunnel(baseInput({ firings: [] }));
    expect(result.diagnostics.survivorPrecision).toBeNull();
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

// ─── Scorer-level FP handling (NOT the parity test) ──
//
// The real bidirectional firing-parity test (S1+C1) — replay firings ==
// production firings through enrichWithAstContext + the rule engine, covering
// both the regex/astContext over-fire suppression and the AST whole-file
// under-fire cases — lives in `windtunnel-parity.test.ts`. That test exercises
// the production classification path end-to-end; the case below only confirms
// the scorer turns a labeled FP into a FAIL verdict.

describe('scorer FP handling (see windtunnel-parity.test.ts for the real S1+C1 parity test)', () => {
  it('a firing labeled FP (e.g. a comment-context match) yields FAIL with precision < 1', () => {
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
