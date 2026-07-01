import { describe, expect, it } from 'vitest';

import type { AuthoredNonEmission, AuthoredPositiveControl } from './authored-controls.js';
import { firingLabelId } from './windtunnel-lock.js';
import type { GroundTruthLabel, RuleFiring } from './windtunnel-scorer.js';
import type { AuthoredScorerInput } from './windtunnel-scorer-authored.js';
import { scoreAuthoredWindtunnel } from './windtunnel-scorer-authored.js';

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

function posControl(
  targetRuleId: string,
  pr: number,
  overrides?: Partial<AuthoredPositiveControl>,
): AuthoredPositiveControl {
  return {
    pr,
    targetRuleId,
    filePath: 'src/foo.ts',
    matchedSpan: 'L1-L1',
    ...overrides,
  };
}

function nonEmission(
  targetRuleId: string,
  pr: number,
  outcome: AuthoredNonEmission['outcome'],
  cls: AuthoredNonEmission['class'],
  reason?: string,
): AuthoredNonEmission {
  return {
    targetRuleId,
    pr,
    outcome,
    class: cls,
    ...(reason !== undefined ? { reason } : {}),
  };
}

/**
 * A baseline authored input. Exposure floors are all 0 so a clean run reaches the
 * mined scorer's PASS tier unless a test trips a specific guard; `actualExposure`
 * mirrors the mined caller (train-side positive count in the third leg).
 */
function baseInput(overrides?: Partial<AuthoredScorerInput>): AuthoredScorerInput {
  return {
    firings: [],
    groundTruth: new Map(),
    mintedRuleIds: ['rule-a'],
    cullRateThreshold: 0.5,
    exposureFloors: {
      activeRulesEvaluated: 0,
      filesTouchedInWindow: 0,
      positiveControlsExercised: 0,
    },
    actualExposure: {
      activeRulesEvaluated: 1,
      filesTouchedInWindow: 5,
      positiveControlsExercised: 1,
    },
    authoredControls: { positive: [], nonEmissions: [] },
    heldOutPrs: new Set<number>(),
    ...overrides,
  };
}

/** A TP-labeled ground truth for the given firings' labelIds. */
function labelAll(firings: RuleFiring[], label: GroundTruthLabel): Map<string, GroundTruthLabel> {
  return new Map(firings.map((f) => [f.labelId, label] as const));
}

// ─── Reduction baseline: a clean authored run reduces to a mined PASS ─────────

describe('reduces to scoreWindtunnel (Q1: reduce, never fork)', () => {
  it('a clean authored run (holding positive control, no FP) → PASS, gate effect none', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl],
        groundTruth: labelAll([ctrl], 'TP'),
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('PASS');
    expect(result.nonVacuity).toBe(true);
    expect(result.authoredControlGate.effect).toBe('none');
    // Join-back key present with 0 — rare-defect (a) shape, no held-out activation.
    expect(result.heldOutActivationsByRule).toEqual({ 'rule-a': 0 });
  });
});

// ─── (a) rare-defect: valid train control, zero held-out → PASS + key===0 ─────

describe('(a) rare-defect: train control fires, heldOut===0, no Gate-2 exemption', () => {
  it('PASS with heldOutActivationsByRule[rule]===0 (present, not omitted)', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl],
        groundTruth: labelAll([ctrl], 'TP'),
        heldOutPrs: new Set([20, 21]),
      }),
    );
    expect(result.verdict).toBe('PASS');
    expect(result.heldOutActivationsByRule).toEqual({ 'rule-a': 0 });
  });
});

// ─── (b) train-slice FP → window-wide FAIL ───────────────────────────────────

describe('(b) train-slice FP → window-wide FAIL', () => {
  it('a corpus firing on a TRAIN pr labeled FP fails the whole window', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const fp = makeFiring('rule-a', 10, 'corpus', 'bad(train);'); // train pr, not in heldOutPrs
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl, fp],
        groundTruth: new Map<string, GroundTruthLabel>([
          [ctrl.labelId, 'TP'],
          [fp.labelId, 'FP'],
        ]),
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.precision).not.toBeNull();
    expect(result.authoredControlGate.effect).toBe('none');
  });
});

// ─── (c) own-control firing excluded from the held-out count ──────────────────

describe('(c) O3 excludes a rule’s own control firing from the held-out count', () => {
  it('only controlKind=corpus firings on held-out prs count', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const heldCorpus = makeFiring('rule-a', 20, 'corpus', 'gen();');
    const heldOwnControl = makeFiring('rule-a', 20, 'positive', 'ctrl-on-held();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl, heldCorpus, heldOwnControl],
        groundTruth: labelAll([ctrl, heldCorpus], 'TP'),
        heldOutPrs: new Set([20]),
      }),
    );
    // The unlabeled own-control firing on the held-out PR routes to needsAdjudication,
    // so the run is HONEST-NEGATIVE — asserted explicitly so this O3-exclusion scenario's
    // verdict is not silently assumed to PASS (greptile #2283).
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    // The held-out control-kind firing is NOT counted; only the corpus one is.
    expect(result.heldOutActivationsByRule).toEqual({ 'rule-a': 1 });
  });
});

// ─── (d) cull symmetry: a culled rule is out of the metric + its keys ─────────

describe('(d) negative-control cull symmetry', () => {
  it('a culled rule is excluded from heldOutActivationsByRule even with valid held-out firings', () => {
    const neg = makeFiring('rule-a', 99, 'negative', 'near-miss;');
    const heldCorpus = makeFiring('rule-a', 20, 'corpus', 'gen();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [neg, heldCorpus],
        groundTruth: labelAll([heldCorpus], 'TP'),
        heldOutPrs: new Set([20]),
        mintedRuleIds: ['rule-a'],
      }),
    );
    expect(result.culledCount).toBe(1);
    // rule-a is culled → excluded from the metric ENTIRELY (not even a 0 key).
    expect(result.heldOutActivationsByRule).toEqual({});
  });
});

// ─── (e) window-wide unlabeled → HONEST-NEGATIVE ──────────────────────────────

describe('(e) window-wide unlabeled firing → HONEST-NEGATIVE', () => {
  it('an unlabeled corpus firing routes to needsAdjudication → HN', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const unlabeled = makeFiring('rule-a', 20, 'corpus', 'mystery();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl, unlabeled],
        groundTruth: labelAll([ctrl], 'TP'), // unlabeled has no entry
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.needsAdjudication).toContain(unlabeled.labelId);
    expect(result.authoredControlGate.effect).toBe('none');
  });
});

// ─── (f) FP FAIL outranks generalization ──────────────────────────────────────

describe('(f) FP FAIL outranks generalization', () => {
  it('a heavily generalizing rule with an FP still FAILs; metric stays inert', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const g1 = makeFiring('rule-a', 20, 'corpus', 'gen-1();');
    const g2 = makeFiring('rule-a', 21, 'corpus', 'gen-2();');
    const g3fp = makeFiring('rule-a', 22, 'corpus', 'gen-3-bad();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl, g1, g2, g3fp],
        groundTruth: new Map<string, GroundTruthLabel>([
          [ctrl.labelId, 'TP'],
          [g1.labelId, 'TP'],
          [g2.labelId, 'TP'],
          [g3fp.labelId, 'FP'],
        ]),
        heldOutPrs: new Set([20, 21, 22]),
      }),
    );
    expect(result.verdict).toBe('FAIL');
    // Metric is verdict-inert: it still reports all 3 held-out activations.
    expect(result.heldOutActivationsByRule).toEqual({ 'rule-a': 3 });
  });
});

// ─── (g) exposure counts train-side controls only ─────────────────────────────

describe('(g) exposure floor counts train-side controls only', () => {
  it('held-out activations do not inflate positiveControlsExercised', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const held1 = makeFiring('rule-a', 20, 'corpus', 'gen-1();');
    const held2 = makeFiring('rule-a', 21, 'corpus', 'gen-2();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: { positive: [posControl('rule-a', 10)], nonEmissions: [] },
        firings: [ctrl, held1, held2],
        groundTruth: labelAll([ctrl, held1, held2], 'TP'),
        heldOutPrs: new Set([20, 21]),
        actualExposure: {
          activeRulesEvaluated: 1,
          filesTouchedInWindow: 5,
          positiveControlsExercised: 1,
        },
      }),
    );
    // Third exposure leg stays the train-side control count (1), unaffected by the 2 held-out firings.
    expect(result.exposureTuple[2]).toBe(1);
    expect(result.heldOutActivationsByRule).toEqual({ 'rule-a': 2 });
  });
});

// ─── (codex-1) all-positives-non-emission + no FP must NOT PASS ───────────────

describe('(codex-1) all positive fixtures culled (illegitimate) + no FP → NOT PASS', () => {
  it('empty positive[] with an illegitimate non-emission FAILs (not a silent PASS)', () => {
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [],
          nonEmissions: [nonEmission('rule-a', 10, 'fix-shaped', 'illegitimate')],
        },
        firings: [],
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.precision).toBeNull();
    expect(result.authoredControlGate.effect).toBe('fail-illegitimate');
    expect(result.authoredControlGate.illegitimate).toBe(1);
  });
});

// ─── (codex-2) mixed emitted + illegitimate must not vanish ───────────────────

describe('(codex-2) mixed emitted + illegitimate control', () => {
  it('the illegitimate non-emission FAILs even when another fixture emitted a holding control', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [posControl('rule-a', 10)],
          nonEmissions: [nonEmission('rule-a', 11, 'over-match', 'illegitimate')],
        },
        firings: [ctrl],
        groundTruth: labelAll([ctrl], 'TP'),
        heldOutPrs: new Set([20]),
      }),
    );
    // Non-vacuity would be satisfied by the emitted control — the illegitimate must still poison it.
    expect(result.nonVacuity).toBe(true);
    expect(result.verdict).toBe('FAIL');
    expect(result.authoredControlGate.effect).toBe('fail-illegitimate');
  });
});

// ─── undecidable / deferred non-emission → HONEST-NEGATIVE (not-certifiable) ──

describe('undecidable / deferred non-emission → HONEST-NEGATIVE (never a silent skip)', () => {
  it('an undecidable non-emission demotes a would-be PASS to HN', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [posControl('rule-a', 10)],
          nonEmissions: [
            nonEmission('rule-a', 11, 'needs-adjudication', 'undecidable', 'ambiguous'),
          ],
        },
        firings: [ctrl],
        groundTruth: labelAll([ctrl], 'TP'),
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.precision).toBeNull();
    expect(result.authoredControlGate.effect).toBe('honest-negative-not-certifiable');
    expect(result.authoredControlGate.undecidable).toBe(1);
  });

  it('a deferred non-emission is not-certifiable (deferred source)', () => {
    const ctrl = makeFiring('rule-a', 10, 'positive');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [posControl('rule-a', 10)],
          nonEmissions: [nonEmission('rule-a', 11, 'unsupported-source', 'deferred')],
        },
        firings: [ctrl],
        groundTruth: labelAll([ctrl], 'TP'),
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('HONEST-NEGATIVE');
    expect(result.authoredControlGate.effect).toBe('honest-negative-not-certifiable');
    expect(result.authoredControlGate.deferred).toBe(1);
  });

  it('illegitimate outranks undecidable when both are present (FAIL, not HN)', () => {
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [],
          nonEmissions: [
            nonEmission('rule-a', 10, 'needs-adjudication', 'undecidable'),
            nonEmission('rule-a', 11, 'vacuous-silent', 'illegitimate'),
          ],
        },
        firings: [],
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.authoredControlGate.effect).toBe('fail-illegitimate');
  });
});

// ─── gate is demote-only: a real FP FAIL keeps its breaching precision ────────

describe('the non-emission gate is demote-only (mirrors the mined FAIL-tier ordering)', () => {
  it('a real FP FAIL co-occurring with an illegitimate non-emission keeps the FP precision', () => {
    // Build-altitude micro-decision (flagged for strategy couple-on-merge): a structural
    // control defect does not erase a real FP measurement — the run FAILs either way.
    const fp = makeFiring('rule-a', 10, 'corpus', 'bad();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [],
          nonEmissions: [nonEmission('rule-a', 11, 'fix-shaped', 'illegitimate')],
        },
        firings: [fp],
        groundTruth: new Map<string, GroundTruthLabel>([[fp.labelId, 'FP']]),
        heldOutPrs: new Set([20]),
      }),
    );
    expect(result.verdict).toBe('FAIL');
    // FP measurement survives the structural gate (the chosen precedence).
    expect(result.precision).not.toBeNull();
    // The COUNT is the presence signal, NOT `effect`: the illegitimate non-emission is
    // recorded even though the demote-only combine left the already-FAIL verdict unchanged
    // (effect stays 'none'). Strategy's couple-on-merge ask + CR — this freezes the
    // "a D4 consumer reads authoredControlGate.illegitimate, never `effect`" contract.
    expect(result.authoredControlGate.illegitimate).toBe(1);
    expect(result.authoredControlGate.effect).toBe('none');
  });
});

// ─── multi-rule window: gate is window-level + O3 keys isolated per rule ──────

describe('multi-rule window (gate is window-level, O3 keys isolated per rule)', () => {
  it('an illegitimate control on rule-b FAILs the window even though rule-a is clean, and O3 keys only rule-a', () => {
    // rule-a: a clean, holding positive control that fires + generalizes on a held-out PR.
    // rule-b: NO positive control (all fixtures illegitimate) — it must poison the WINDOW
    // (not just its own rule) and must NOT leak into the O3 keys (join-back is from positive[]).
    const ctrlA = makeFiring('rule-a', 10, 'positive');
    const heldA = makeFiring('rule-a', 20, 'corpus', 'gen-a();');
    const heldB = makeFiring('rule-b', 20, 'corpus', 'gen-b();');
    const result = scoreAuthoredWindtunnel(
      baseInput({
        authoredControls: {
          positive: [posControl('rule-a', 10)],
          nonEmissions: [nonEmission('rule-b', 12, 'fix-shaped', 'illegitimate')],
        },
        firings: [ctrlA, heldA, heldB],
        groundTruth: labelAll([ctrlA, heldA, heldB], 'TP'),
        heldOutPrs: new Set([20]),
        mintedRuleIds: ['rule-a', 'rule-b'],
      }),
    );
    // (1) window-level: rule-a's control is clean, yet rule-b's illegitimate non-emission
    // FAILs the whole window (the gate is not scoped to rules lacking a positive control).
    expect(result.verdict).toBe('FAIL');
    expect(result.authoredControlGate.effect).toBe('fail-illegitimate');
    expect(result.authoredControlGate.illegitimate).toBe(1);
    // (2) O3 key isolation: rule-a is keyed (from positive[]) and counts its 1 held-out
    // firing; rule-b fired on a held-out PR but has NO positive control → NOT a key.
    expect(result.heldOutActivationsByRule).toEqual({ 'rule-a': 1 });
  });
});
