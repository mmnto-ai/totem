import { describe, expect, it } from 'vitest';

import type { CompiledRule } from '../compiler-schema.js';
import { makeRuleEngineCtx } from '../test-utils.js';
import {
  ArchivedRuleInScopeError,
  assertNoArchivedRules,
  assertUniqueFiringLabels,
  buildFirings,
  computePerRuleControlResults,
  FiringLabelCollisionError,
  type ResolvedPrDiff,
} from './windtunnel-firing.js';
import { firingLabelId } from './windtunnel-lock.js';
import type { GroundTruthLabel, RuleFiring } from './windtunnel-scorer.js';
import { scoreWindtunnel } from './windtunnel-scorer.js';

// ─── Fixtures ────────────────────────────────────────

const FILE = 'src/app.ts';

/** A regex rule firing on the literal `debugger` token (code context). */
function debuggerRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'rule-debugger',
    lessonHeading: 'No debugger',
    pattern: 'debugger',
    message: 'debugger statement',
    engine: 'regex',
    compiledAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

/** A regex rule firing on `eval(` (a second, distinct rule). */
function evalRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'rule-eval',
    lessonHeading: 'No eval',
    pattern: 'eval\\(',
    message: 'eval call',
    engine: 'regex',
    compiledAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a unified diff that ADDS the given lines to FILE starting at line 1. */
function diffAdding(lines: string[], file = FILE): string {
  const body = lines.map((l) => `+${l}`).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ].join('\n');
}

/** readStrategy returning a fixed post-image for any file (zero-LLM, no disk). */
function fixedReadStrategy(content: string): (file: string) => Promise<string | null> {
  return async () => content;
}

// ─── Real-engine path (replaces runMockEngine) ───────

describe('buildFirings — real engine path', () => {
  it('fires the regex rule on a real code line and maps it to a RuleFiring with a content-based labelId', async () => {
    const post = ['function run() {', '  debugger;', '}'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 100, diff: diffAdding(['  debugger;']), controlKind: 'corpus' }, // totem-ignore
    ];
    const result = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });

    expect(result.firings).toHaveLength(1);
    const firing = result.firings[0]!;
    expect(firing.ruleId).toBe('rule-debugger');
    expect(firing.pr).toBe(100);
    expect(firing.controlKind).toBe('corpus');
    expect(firing.labelId).toBe(firingLabelId('rule-debugger', 100, FILE, firing.matchedLine));
  });

  it('suppresses an over-fire: a regex match inside a comment is NOT a firing (astContext parity, C1)', async () => {
    // Line 2 is real code; line 3 is a comment. Both are added. The engine must
    // fire only on the code line (the comment match is telemetry-only).
    const post = [
      'function run() {',
      '  debugger;', // 2 — code // totem-ignore
      '  // debugger; left here — comment // totem-ignore', // 3 — comment
      '}',
    ].join('\n');
    const prDiffs: ResolvedPrDiff[] = [
      {
        pr: 101,
        diff: diffAdding([
          '  debugger;', // totem-ignore
          '  // debugger; left here — comment // totem-ignore',
        ]),
        controlKind: 'corpus',
      },
    ];
    const result = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });

    // Only the code line fires.
    expect(result.firings).toHaveLength(1);
    expect(result.firings[0]!.matchedLine).toContain('debugger');
  });

  it('counts distinct touched files across all diffs (C2 real exposure)', async () => {
    const post = 'const x = 1;\n';
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['const x = 1;'], 'src/a.ts'), controlKind: 'corpus' },
      { pr: 2, diff: diffAdding(['const y = 2;'], 'src/b.ts'), controlKind: 'corpus' },
      { pr: 3, diff: diffAdding(['const z = 3;'], 'src/a.ts'), controlKind: 'corpus' }, // dup file
    ];
    const result = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    expect(result.filesTouchedInWindow).toBe(2); // a.ts + b.ts, not 3
  });

  it('derives positiveControlTargets from positive-control diffs', async () => {
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      {
        pr: 50,
        diff: diffAdding(['  debugger;']), // totem-ignore
        controlKind: 'positive',
        targetRuleId: 'rule-debugger',
      },
    ];
    const result = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    expect(result.positiveControlTargets).toEqual([{ pr: 50, targetRuleId: 'rule-debugger' }]);
    expect(result.firings[0]!.controlKind).toBe('positive');
    expect(result.firings[0]!.targetRuleId).toBe('rule-debugger');
  });

  it('fold-H: a firing on a NEGATIVE control passes through as controlKind:negative (not dropped)', async () => {
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 99, diff: diffAdding(['  debugger;']), controlKind: 'negative' }, // totem-ignore
    ];
    const result = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    expect(result.firings).toHaveLength(1);
    expect(result.firings[0]!.controlKind).toBe('negative');
  });

  it('emits no firings when no rule matches the diff', async () => {
    const post = 'const safe = 1;\n';
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['const safe = 1;']), controlKind: 'corpus' },
    ];
    const result = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    expect(result.firings).toHaveLength(0);
  });
});

// ─── fold-F: archived-excluded loud assert ───────────

describe('fold-F — archived rule in scored set throws (Tenet 4)', () => {
  it('assertNoArchivedRules throws naming the archived rule', () => {
    const rules = [debuggerRule(), evalRule({ status: 'archived' })];
    expect(() => assertNoArchivedRules(rules)).toThrow(ArchivedRuleInScopeError);
    expect(() => assertNoArchivedRules(rules)).toThrow(/rule-eval/);
  });

  it('assertNoArchivedRules passes on active-only rules', () => {
    expect(() =>
      assertNoArchivedRules([debuggerRule({ status: 'active' }), evalRule()]),
    ).not.toThrow();
  });

  it('buildFirings throws (and never invokes the engine) when an archived rule is present', async () => {
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['  debugger;']), controlKind: 'corpus' }, // totem-ignore
    ];
    await expect(
      buildFirings({
        rules: [debuggerRule(), evalRule({ status: 'archived' })],
        prDiffs,
        cwd: '/repo',
        readStrategy: fixedReadStrategy(post),
        ruleEngineCtx: makeRuleEngineCtx(),
      }),
    ).rejects.toThrow(ArchivedRuleInScopeError);
  });

  it('zero archived refs reach the firings (the engine ran only on active rules)', async () => {
    const post = ['  debugger;', '  eval(x);'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      {
        pr: 1,
        diff: diffAdding(['  debugger;', '  eval(x);']), // totem-ignore
        controlKind: 'corpus',
      },
    ];
    const result = await buildFirings({
      rules: [debuggerRule(), evalRule()], // both active
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    const firedRuleIds = new Set(result.firings.map((f) => f.ruleId));
    expect(firedRuleIds.has('rule-debugger')).toBe(true);
    expect(firedRuleIds.has('rule-eval')).toBe(true);
  });
});

// ─── A1 (fold-D): hard-gate-unique FLOOR ─────────────

describe('A1 (fold-D) — assertUniqueFiringLabels hard-gate', () => {
  function firing(labelId: string, ruleId = 'r', pr = 1): RuleFiring {
    return { ruleId, pr, filePath: FILE, matchedLine: 'x', controlKind: 'corpus', labelId };
  }

  it('passes when all labelIds are unique', () => {
    expect(() => assertUniqueFiringLabels([firing('a'), firing('b'), firing('c')])).not.toThrow();
  });

  it('throws a FiringLabelCollisionError when two firings share a labelId', () => {
    expect(() => assertUniqueFiringLabels([firing('dup'), firing('dup')])).toThrow(
      FiringLabelCollisionError,
    );
  });

  it('surfaces the colliding labelId + every evidence ref', () => {
    const dup = firingLabelId('r', 1, FILE, 'line');
    const a: RuleFiring = {
      ruleId: 'r',
      pr: 1,
      filePath: FILE,
      matchedLine: 'line',
      controlKind: 'corpus',
      labelId: dup,
    };
    const b: RuleFiring = { ...a };
    let caught: FiringLabelCollisionError | undefined;
    try {
      assertUniqueFiringLabels([a, b]);
    } catch (err) {
      caught = err as FiringLabelCollisionError;
    }
    expect(caught).toBeInstanceOf(FiringLabelCollisionError);
    expect(caught!.collisions).toHaveLength(1);
    expect(caught!.collisions[0]!.labelId).toBe(dup);
    expect(caught!.collisions[0]!.evidenceRefs).toHaveLength(2);
    expect(caught!.collisions[0]!.evidenceRefs[0]!.ruleId).toBe('r');
  });
});

// ─── C1: per-rule control results (NOT global nonVacuity) ─

describe('C1 — computePerRuleControlResults (per-rule, survivor-only)', () => {
  function f(
    ruleId: string,
    controlKind: RuleFiring['controlKind'],
    pr: number,
    matched = 'x',
  ): RuleFiring {
    return {
      ruleId,
      pr,
      filePath: FILE,
      matchedLine: matched,
      controlKind,
      labelId: firingLabelId(ruleId, pr, FILE, matched),
    };
  }

  it('positiveControl is true ONLY for the rule that fired its declared target (never global)', () => {
    // rule-a fired its positive target on pr 10; rule-b is a survivor that never
    // exercised a positive control. The global nonVacuity (all targets fired)
    // would be true — but rule-b's positiveControl must NOT inherit that.
    const firings = [f('rule-a', 'positive', 10), f('rule-b', 'corpus', 1)];
    const result = computePerRuleControlResults({
      firings,
      mintedRuleIds: ['rule-a', 'rule-b'],
      positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }],
    });
    expect(result.get('rule-a')!.positiveControl).toBe(true);
    expect(result.get('rule-b')!.positiveControl).toBe(false);
  });

  it('negativeControl is false (and the rule is excluded as culled) when it fires on a negative control', () => {
    const firings = [f('rule-a', 'negative', 99)];
    const result = computePerRuleControlResults({
      firings,
      mintedRuleIds: ['rule-a', 'rule-b'],
      positiveControlTargets: [],
    });
    // rule-a fired on a negative control → culled → not a survivor → absent.
    expect(result.has('rule-a')).toBe(false);
    // rule-b never fired on a negative control → clean (negativeControl true).
    expect(result.get('rule-b')!.negativeControl).toBe(true);
  });

  it('a clean survivor carries negativeControl:true with no positive evidence', () => {
    const result = computePerRuleControlResults({
      firings: [],
      mintedRuleIds: ['rule-a'],
      positiveControlTargets: [],
    });
    expect(result.get('rule-a')).toEqual({
      positiveControl: false,
      negativeControl: true,
      evidenceRefs: [],
    });
  });

  it('records evidenceRefs (the firingLabelIds) for both control legs', () => {
    const posFiring = f('rule-a', 'positive', 10);
    const result = computePerRuleControlResults({
      firings: [posFiring],
      mintedRuleIds: ['rule-a'],
      positiveControlTargets: [{ pr: 10, targetRuleId: 'rule-a' }],
    });
    expect(result.get('rule-a')!.evidenceRefs).toContain(posFiring.labelId);
  });
});

// ─── fold-H: OQ4 real-firing integration matrix ──────
//
// End-to-end through the REAL engine (buildFirings) → scoreWindtunnel. Zero-LLM,
// deterministic: fixture rules + fixture diffs + injected post-image readStrategy.

describe('fold-H — OQ4 real-firing matrix (buildFirings → scoreWindtunnel)', () => {
  /** Run the deterministic engine, gate uniqueness (A1), then score. */
  async function fireAndScore(opts: {
    rules: CompiledRule[];
    prDiffs: ResolvedPrDiff[];
    post: string;
    groundTruth?: Map<string, GroundTruthLabel>;
    mintedRuleIds?: string[];
    exposureFloors?: {
      activeRulesEvaluated: number;
      filesTouchedInWindow: number;
      positiveControlsExercised: number;
    };
  }) {
    const built = await buildFirings({
      rules: opts.rules,
      prDiffs: opts.prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(opts.post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    assertUniqueFiringLabels(built.firings); // A1 pre-score gate
    const mintedRuleIds = opts.mintedRuleIds ?? opts.rules.map((r) => r.lessonHash);
    return scoreWindtunnel({
      firings: built.firings,
      groundTruth: opts.groundTruth ?? new Map(),
      positiveControlTargets: built.positiveControlTargets,
      mintedRuleIds,
      cullRateThreshold: 0.9,
      exposureFloors: opts.exposureFloors ?? {
        activeRulesEvaluated: 0,
        filesTouchedInWindow: 0,
        positiveControlsExercised: 0,
      },
      actualExposure: {
        activeRulesEvaluated: mintedRuleIds.length,
        filesTouchedInWindow: built.filesTouchedInWindow,
        positiveControlsExercised: built.positiveControlTargets.length,
      },
    });
  }

  it('confirmed-FP firing (sub-floor precision) ⟹ FAIL', async () => {
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['  debugger;']), controlKind: 'corpus' }, // totem-ignore
    ];
    const built = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    const fpLabel = built.firings[0]!.labelId;
    const verdict = await fireAndScore({
      rules: [debuggerRule()],
      prDiffs,
      post,
      groundTruth: new Map([[fpLabel, 'FP']]),
    });
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.precision).toBeLessThan(1);
  });

  it('vacuous positive control (target never fires) ⟹ FAIL / null precision', async () => {
    // The positive control declares rule-eval must fire, but the post-image has
    // no eval( — so the target never fires (vacuous).
    const post = ['const safe = 1;'].join('\n');
    const prDiffs: ResolvedPrDiff[] = [
      {
        pr: 10,
        diff: diffAdding(['const safe = 1;']),
        controlKind: 'positive',
        targetRuleId: 'rule-eval',
      },
    ];
    const verdict = await fireAndScore({ rules: [evalRule()], prDiffs, post });
    expect(verdict.verdict).toBe('FAIL');
    expect(verdict.nonVacuity).toBe(false);
    expect(verdict.precision).toBeNull();
  });

  it('unlabeled firing ⟹ HONEST-NEGATIVE (needsAdjudication)', async () => {
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['  debugger;']), controlKind: 'corpus' }, // totem-ignore
    ];
    const verdict = await fireAndScore({
      rules: [debuggerRule()],
      prDiffs,
      post,
      groundTruth: new Map(), // unlabeled
    });
    expect(verdict.verdict).toBe('HONEST-NEGATIVE');
    expect(verdict.needsAdjudication).toHaveLength(1);
  });

  it('all-TP firings with exposure met ⟹ PASS', async () => {
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['  debugger;']), controlKind: 'corpus' }, // totem-ignore
    ];
    const built = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    const tpLabel = built.firings[0]!.labelId;
    const verdict = await fireAndScore({
      rules: [debuggerRule()],
      prDiffs,
      post,
      groundTruth: new Map([[tpLabel, 'TP']]),
    });
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.precision).toBe(1.0);
  });

  it('C2: real filesTouched below the floor ⟹ HONEST-NEGATIVE even when the other legs pass', async () => {
    // One TP firing on a single file. The other two legs pass (activeRules ok,
    // no positive controls required) but the filesTouchedInWindow floor is 5 and
    // only 1 file is touched → the third leg demotes to HONEST-NEGATIVE.
    const post = ['  debugger;'].join('\n'); // totem-ignore
    const prDiffs: ResolvedPrDiff[] = [
      { pr: 1, diff: diffAdding(['  debugger;']), controlKind: 'corpus' }, // totem-ignore
    ];
    const built = await buildFirings({
      rules: [debuggerRule()],
      prDiffs,
      cwd: '/repo',
      readStrategy: fixedReadStrategy(post),
      ruleEngineCtx: makeRuleEngineCtx(),
    });
    const tpLabel = built.firings[0]!.labelId;
    const verdict = await fireAndScore({
      rules: [debuggerRule()],
      prDiffs,
      post,
      groundTruth: new Map([[tpLabel, 'TP']]),
      exposureFloors: {
        activeRulesEvaluated: 0,
        filesTouchedInWindow: 5, // floor exceeds the 1 file actually touched
        positiveControlsExercised: 0,
      },
    });
    expect(built.filesTouchedInWindow).toBe(1);
    expect(verdict.verdict).toBe('HONEST-NEGATIVE');
    expect(verdict.precision).toBeNull();
  });
});
