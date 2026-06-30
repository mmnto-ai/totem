import { describe, expect, it, vi } from 'vitest';

import {
  type AuthoredFixture,
  type AuthoredNegativeFixture,
  type AuthoredProvenanceRecord,
  type CompiledRule,
  type ProvenanceRecord,
} from '../compiler-schema.js';
import {
  type AuthoredControlsDeps,
  AuthoredNonEmissionSchema,
  deriveAuthoredControls,
} from './authored-controls.js';
import type {
  PreimageDifferentialOutcome,
  PreimageDifferentialResult,
} from './preimage-differential.js';
import { getRulePolicy } from './rule-policy.js';
import { resolveSplit, type SplitArtifact, SplitCoverError } from './split.js';

// Wrap the two cross-module seams in pass-through spies (mirrors compile.test.ts):
//  - `resolveSplit` — to assert deriveAuthoredControls NEVER routes through it (the
//    train-side controls use a SEPARATE path); the mirror test still calls the real
//    impl (vi.fn passes through to `actual`).
//  - `getRulePolicy` — to drive the §9 producer-mismatch fail-loud guards with a
//    one-shot wrong policy; every other test passes through to the real frozen one.
vi.mock('./split.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./split.js')>();
  return { ...actual, resolveSplit: vi.fn(actual.resolveSplit) };
});
vi.mock('./rule-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rule-policy.js')>();
  return { ...actual, getRulePolicy: vi.fn(actual.getRulePolicy) };
});

// ─── Constants ──────────────────────────────────────

/** A 16-hex `hashLesson` codomain id (the lesson preimageSource's immutable ref). */
const LESSON_REF = 'deadbeefdeadbeef';
/** Per-index delay unit for the determinism probe (slow-FIRST). */
const DELAY_UNIT_MS = 4;

const sha = (n: number): string => String(n).padStart(40, '0');

// ─── Fixture / rule helpers ─────────────────────────

function posFixture(pr: number, contentHash: string, filePath = 'src/a.ts'): AuthoredFixture {
  return {
    pr,
    preimageSource: {
      kind: 'lesson',
      lessonRef: LESSON_REF,
      badExample: 'bad()',
      goodExample: 'good()',
    },
    filePath,
    matchedSpan: 'L1-L2',
    contentHash,
  };
}

function negFixture(filePath: string, matchedSpan: string): AuthoredNegativeFixture {
  return {
    filePath,
    matchedSpan,
    nearMissSource: { kind: 'lesson', example: 'nearMiss()' },
  };
}

function authoredRule(
  lessonHash: string,
  positiveFixtures: AuthoredFixture[],
  negativeFixtures?: AuthoredNegativeFixture[],
): CompiledRule {
  const provenance: AuthoredProvenanceRecord = {
    kind: 'authored',
    author: 'agent-x',
    authoredAt: '2026-06-01',
    targetDefect: 'a real lc defect',
    positiveFixtures,
    ...(negativeFixtures ? { negativeFixtures } : {}),
  };
  return {
    lessonHash,
    lessonHeading: 'Authored rule',
    pattern: 'bad',
    message: 'no bad',
    engine: 'regex',
    compiledAt: '2026-06-01T00:00:00Z',
    legitimacy: { provenance, positiveControl: true, negativeControl: true },
  };
}

/**
 * Build the SIDECAR `provenanceByRule` map the reshaped builder reads (D1 fold #1):
 * `lessonHash → provenance`. `authoredRule` still stamps `legitimacy.provenance` (a
 * convenient carrier for the test's intent), but the FUNCTION reads only this map —
 * never `rule.legitimacy` — so routing the same provenance through the map keeps the
 * tests faithful to the real assembly seam (compiled rules carry no legitimacy there).
 */
function provBy(rules: CompiledRule[]): Map<string, ProvenanceRecord> {
  return new Map(rules.map((r) => [r.lessonHash, r.legitimacy!.provenance]));
}

/**
 * Test driver: invoke the reshaped builder with the SIDECAR provenance map (D1 fold #1)
 * derived from each rule's stamped provenance. The builder reads ONLY the map; this keeps
 * every existing case faithful to the assembly seam (where compiled rules carry no
 * legitimacy) without threading the map by hand. Cases that need a DIVERGENT map (missing /
 * mined provenance) call `deriveAuthoredControls` directly instead.
 */
function derive(args: {
  rules: CompiledRule[];
  split: SplitArtifact;
  deps?: AuthoredControlsDeps;
}): ReturnType<typeof deriveAuthoredControls> {
  return deriveAuthoredControls({
    rules: args.rules,
    split: args.split,
    provenanceByRule: provBy(args.rules),
    ...(args.deps ? { deps: args.deps } : {}),
  });
}

/** A minimal valid SplitArtifact — only `trainPrs` is read by the builder. */
function splitWithTrain(trainPrs: number[], heldOutPrs: number[] = []): SplitArtifact {
  return {
    asOfCommit: sha(999),
    trainPrs,
    heldOutPrs,
    excludedPrs: [],
    positiveControlPrs: [],
    negativeControlPrs: [],
    splitRule: { predicate: 'code-touching non-bot', cutIndex: Math.max(trainPrs.length, 1) },
  };
}

// ─── Differential-evaluator stubs (no git, no engine) ─

function makeResult(
  outcome: PreimageDifferentialOutcome,
  reason?: string,
): PreimageDifferentialResult {
  return {
    outcome,
    sourceKind: 'lesson',
    firesOnPreimage: null,
    silentOnPostimage: null,
    preimageMatchCount: null,
    postimageMatchCount: null,
    ...(reason !== undefined ? { reason } : {}),
  };
}

/** Scripts a differential result per fixture (keyed on its unique contentHash). */
function scriptedDeps(
  byContentHash: Record<string, PreimageDifferentialResult>,
): AuthoredControlsDeps {
  return {
    evaluate: (_rule, fixture) => {
      const result = byContentHash[fixture.contentHash];
      if (result === undefined) {
        throw new Error(`test stub: no scripted result for contentHash '${fixture.contentHash}'`);
      }
      return Promise.resolve(result);
    },
  };
}

/** An evaluator that throws if ever invoked — proves negatives never run the differential. */
const throwingDeps: AuthoredControlsDeps = {
  evaluate: () => {
    throw new Error('the §4 differential must not run for negative (silence-only) controls');
  },
};

/** Slow-FIRST delays: the earliest task waits the longest, so a push-on-settle impl would reorder. */
function slowFirstDeps(total: number): AuthoredControlsDeps {
  let calls = 0;
  return {
    evaluate: (_rule, _fixture) => {
      const idx = calls++;
      const delayMs = (total - idx) * DELAY_UNIT_MS;
      return new Promise((resolve) =>
        setTimeout(() => resolve(makeResult('differential-holds')), delayMs),
      );
    },
  };
}

// ─── 1. Per-outcome matrix (the §4 gate, exact-equality both directions) ─────

describe('deriveAuthoredControls — per-outcome matrix', () => {
  it('emits a positive ONLY for differential-holds; the other 5 outcomes become classed non-emissions', async () => {
    const rule = authoredRule('rule-auth-1', [
      posFixture(1, 'ch-holds'),
      posFixture(2, 'ch-fix'),
      posFixture(3, 'ch-over'),
      posFixture(4, 'ch-vac'),
      posFixture(5, 'ch-needs'),
      posFixture(6, 'ch-unsup'),
    ]);
    const deps = scriptedDeps({
      'ch-holds': makeResult('differential-holds'),
      'ch-fix': makeResult('fix-shaped'),
      'ch-over': makeResult('over-match'),
      'ch-vac': makeResult('vacuous-silent'),
      'ch-needs': makeResult('needs-adjudication', 'engine refused: invalid regex'),
      'ch-unsup': makeResult('unsupported-source', 'commit-pair source deferred to a later slice'),
    });

    const result = await derive({
      rules: [rule],
      split: splitWithTrain([1, 2, 3, 4, 5, 6]),
      deps,
    });

    // Exactly ONE positive — the holds fixture, carrying ITS locus. This kills
    // the `outcome !== 'fix-shaped'` mutant (which would emit 5 positives).
    expect(result.positive).toEqual([
      { pr: 1, targetRuleId: 'rule-auth-1', filePath: 'src/a.ts', matchedSpan: 'L1-L2' },
    ]);

    // The other five are KEPT (never silently dropped) with the exact source outcome
    // + the correct class.
    expect(result.nonEmissions).toHaveLength(5);
    const byOutcome = new Map(result.nonEmissions.map((n) => [n.outcome, n]));
    expect(byOutcome.get('fix-shaped')).toEqual({
      targetRuleId: 'rule-auth-1',
      pr: 2,
      outcome: 'fix-shaped',
      class: 'illegitimate',
    });
    expect(byOutcome.get('over-match')).toEqual({
      targetRuleId: 'rule-auth-1',
      pr: 3,
      outcome: 'over-match',
      class: 'illegitimate',
    });
    expect(byOutcome.get('vacuous-silent')).toEqual({
      targetRuleId: 'rule-auth-1',
      pr: 4,
      outcome: 'vacuous-silent',
      class: 'illegitimate',
    });
    expect(byOutcome.get('needs-adjudication')).toEqual({
      targetRuleId: 'rule-auth-1',
      pr: 5,
      outcome: 'needs-adjudication',
      class: 'undecidable',
      reason: 'engine refused: invalid regex',
    });
    expect(byOutcome.get('unsupported-source')).toEqual({
      targetRuleId: 'rule-auth-1',
      pr: 6,
      outcome: 'unsupported-source',
      class: 'deferred',
      reason: 'commit-pair source deferred to a later slice',
    });

    // Exact-equality, the OTHER direction: NONE of the 5 non-holds outcomes leaked
    // into positives (the holds one is the sole positive).
    expect(result.positive.map((p) => p.pr)).toEqual([1]);
  });
});

// ─── 2. Two-loci-one-PR disambiguation (strategy#777 Q1(a)) ──────────────────

describe('deriveAuthoredControls — two-loci-one-PR disambiguation', () => {
  it('a PR contributing two distinct-locus fixtures emits ONLY the holding one, carrying ITS locus', async () => {
    const rule = authoredRule('rule-2loci', [
      posFixture(7, 'ch-A', 'src/a.ts'),
      posFixture(7, 'ch-B', 'src/b.ts'),
    ]);
    const deps = scriptedDeps({
      'ch-A': makeResult('differential-holds'),
      'ch-B': makeResult('fix-shaped'),
    });

    const result = await derive({
      rules: [rule],
      split: splitWithTrain([7]),
      deps,
    });

    // The positive carries the src/a.ts locus (the holding fixture) — NOT src/b.ts; the
    // locus disambiguator prevents the wrong-exemplar miscert under a shared pr.
    expect(result.positive).toEqual([
      { pr: 7, targetRuleId: 'rule-2loci', filePath: 'src/a.ts', matchedSpan: 'L1-L2' },
    ]);
    expect(result.nonEmissions).toEqual([
      { targetRuleId: 'rule-2loci', pr: 7, outcome: 'fix-shaped', class: 'illegitimate' },
    ]);
  });

  // strategy#777 §6: the LOCUS (filePath, matchedSpan) is the disambiguator, so two
  // HOLDING fixtures in one PR at DISTINCT loci both emit — even with byte-identical
  // span content (same contentHash). This is the legitimate two-loci-one-PR rule the
  // old contentHash key wrongly FORBADE; emitting two is the whole point of the fix.
  it('emits TWO positives for two HOLDING fixtures sharing a PR at distinct loci (even identical content)', async () => {
    const rule = authoredRule('rule-2loci-hold', [
      posFixture(7, 'ch-same', 'src/a.ts'),
      posFixture(7, 'ch-same', 'src/b.ts'),
    ]);
    const result = await derive({
      rules: [rule],
      split: splitWithTrain([7]),
      deps: scriptedDeps({ 'ch-same': makeResult('differential-holds') }),
    });
    expect(result.positive).toEqual([
      { pr: 7, targetRuleId: 'rule-2loci-hold', filePath: 'src/a.ts', matchedSpan: 'L1-L2' },
      { pr: 7, targetRuleId: 'rule-2loci-hold', filePath: 'src/b.ts', matchedSpan: 'L1-L2' },
    ]);
  });

  // A TRUE duplicate — same pr + filePath + matchedSpan — IS an indistinguishable §6
  // answer-key entry (a real authoring error, not the two-loci rule): fail loud,
  // regardless of content hash (here the two fixtures even differ in contentHash).
  it('throws when two HOLDING fixtures share pr AND filePath AND matchedSpan (same locus)', async () => {
    const rule = authoredRule('rule-dup-pos', [
      posFixture(7, 'ch-x', 'src/a.ts'),
      posFixture(7, 'ch-y', 'src/a.ts'),
    ]);
    await expect(
      derive({
        rules: [rule],
        split: splitWithTrain([7]),
        deps: scriptedDeps({
          'ch-x': makeResult('differential-holds'),
          'ch-y': makeResult('differential-holds'),
        }),
      }),
    ).rejects.toThrow(/duplicate positive control/);
  });

  it('throws when two near-misses share filePath AND matchedSpan (indistinguishable negative key)', async () => {
    const rule = authoredRule(
      'rule-dup-neg',
      [posFixture(1, 'ch-1')],
      [negFixture('src/a.ts', 'L1-L2'), negFixture('src/a.ts', 'L1-L2')],
    );
    await expect(
      derive({
        rules: [rule],
        split: splitWithTrain([1]),
        deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
      }),
    ).rejects.toThrow(/duplicate negative control/);
  });

  // greptile P2 regression guard: the join-key is `JSON.stringify([...])`, NOT a
  // `\0`-joined template — so two DISTINCT loci that merely shift the delimiter
  // boundary (filePath 'a.ts' + span 'L1\0L2'  vs  filePath 'a.ts\0L1' + span 'L2')
  // no longer collide into ONE key. Both emit; the old delimited key falsely threw
  // "duplicate" on a load-bearing D-join target.
  it('distinct negative loci with an embedded delimiter do NOT collide (injection-proof key)', async () => {
    const rule = authoredRule(
      'rule-delim-neg',
      [posFixture(1, 'ch-1')],
      [negFixture('a.ts', 'L1\0L2'), negFixture('a.ts\0L1', 'L2')],
    );
    const result = await derive({
      rules: [rule],
      split: splitWithTrain([1]),
      deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
    });
    expect(result.negative).toEqual([
      { targetRuleId: 'rule-delim-neg', filePath: 'a.ts', matchedSpan: 'L1\0L2' },
      { targetRuleId: 'rule-delim-neg', filePath: 'a.ts\0L1', matchedSpan: 'L2' },
    ]);
  });
});

// ─── 3. Determinism (Tenet-15; slow-first must NOT reorder) ──────────────────

describe('deriveAuthoredControls — determinism', () => {
  it('emits in stable declared order regardless of settle timing, byte-identical across re-runs', async () => {
    const contentHashes = ['ch-0', 'ch-1', 'ch-2', 'ch-3'];
    const rule = authoredRule(
      'rule-det',
      contentHashes.map((ch, i) => posFixture(i + 1, ch)),
    );
    const split = splitWithTrain([1, 2, 3, 4]);

    const runA = await derive({
      rules: [rule],
      split,
      deps: slowFirstDeps(contentHashes.length),
    });
    const runB = await derive({
      rules: [rule],
      split,
      deps: slowFirstDeps(contentHashes.length),
    });

    expect(runA).toEqual(runB);
    // Declared order preserved — a push-on-settle impl with slow-first delays would
    // invert this to [4, 3, 2, 1].
    expect(runA.positive.map((p) => p.pr)).toEqual([1, 2, 3, 4]);
  });
});

// ─── 4. Boundary: never routes through resolveSplit ──────────────────────────

describe('deriveAuthoredControls — boundary vs resolveSplit', () => {
  it('does NOT invoke resolveSplit (train-side controls use a SEPARATE path)', async () => {
    vi.mocked(resolveSplit).mockClear();
    const rule = authoredRule('rule-bnd', [posFixture(1, 'ch-1')]);

    await derive({
      rules: [rule],
      split: splitWithTrain([1]),
      deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
    });

    expect(vi.mocked(resolveSplit)).not.toHaveBeenCalled();
  });

  it('mirror: a TRAIN pr fed as a resolveSplit positive control throws (controls⊄heldOut) — WHY the separate path exists', () => {
    const corpus = [1, 2, 3];
    const mergeCommitByPr = new Map(corpus.map((pr) => [pr, sha(pr)]));
    // cutIndex 2 → train [1,2], heldOut [3]; pr 1 is TRAIN, so as a positive control
    // it violates controls ⊆ heldOut — the exact leakage the C2b path sidesteps.
    expect(() =>
      resolveSplit({
        asOfCommit: sha(999),
        corpus,
        orderedNewestFirst: [3, 2, 1],
        excludedPrs: [],
        cutIndex: 2,
        positiveControlPrs: [1],
        negativeControlPrs: [],
        predicate: 'code-touching',
        mergeCommitByPr,
      }),
    ).toThrow(SplitCoverError);
  });
});

// ─── 5. Fail-loud guards (§5 leakage + §9 producer mismatch) ─────────────────

describe('deriveAuthoredControls — fail-loud guards', () => {
  it('throws when a positive fixture pr is held-out (∉ trainPrs) — an ADR-112 §5 leakage violation', async () => {
    const rule = authoredRule('rule-leak', [posFixture(99, 'ch-leak')]);
    await expect(
      derive({
        rules: [rule],
        split: splitWithTrain([1, 2], [99]), // 99 is held-out, not train
        deps: scriptedDeps({ 'ch-leak': makeResult('differential-holds') }),
      }),
    ).rejects.toThrow(/leakage/i);
  });

  it('throws when authored policy.positiveControlSide is not train (§6 producer mismatch)', async () => {
    vi.mocked(getRulePolicy).mockReturnValueOnce({
      labelScope: 'whole-window',
      positiveControlSide: 'held-out',
      exposureControlSide: 'held-out',
      positiveControlGate: 'preimage-differential',
    });
    const rule = authoredRule('rule-pol', [posFixture(1, 'ch-1')]);
    await expect(
      derive({
        rules: [rule],
        split: splitWithTrain([1]),
        deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
      }),
    ).rejects.toThrow(/positiveControlSide/);
  });

  it('throws when authored policy.positiveControlGate is not preimage-differential (§4 producer mismatch)', async () => {
    vi.mocked(getRulePolicy).mockReturnValueOnce({
      labelScope: 'whole-window',
      positiveControlSide: 'train',
      exposureControlSide: 'train',
      positiveControlGate: 'none',
    });
    const rule = authoredRule('rule-pol2', [posFixture(1, 'ch-1')]);
    await expect(
      derive({
        rules: [rule],
        split: splitWithTrain([1]),
        deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
      }),
    ).rejects.toThrow(/positiveControlGate/);
  });
});

// ─── 6. Negatives are DECLARATIVE (no differential, no silence gate) ─────────

describe('deriveAuthoredControls — declarative negatives', () => {
  it('emits every declared near-miss as {targetRuleId,filePath,matchedSpan} WITHOUT running the evaluator', async () => {
    const rule = authoredRule(
      'rule-neg',
      [], // no positive fixtures → the evaluator must never run
      [negFixture('src/x.ts', 'L5-L9'), negFixture('src/y.ts', 'N[2]')],
    );

    // A throwing evaluator proves the §4 differential/smoke-gate is NOT invoked for
    // negatives — a near-miss is emitted even though no evaluator runs on it.
    const result = await derive({
      rules: [rule],
      split: splitWithTrain([1]),
      deps: throwingDeps,
    });

    expect(result.negative).toEqual([
      { targetRuleId: 'rule-neg', filePath: 'src/x.ts', matchedSpan: 'L5-L9' },
      { targetRuleId: 'rule-neg', filePath: 'src/y.ts', matchedSpan: 'N[2]' },
    ]);
    expect(result.positive).toEqual([]);
    expect(result.nonEmissions).toEqual([]);
  });

  it('emits negatives alongside positives in stable rule/declared order', async () => {
    const rule = authoredRule(
      'rule-mixed',
      [posFixture(1, 'ch-1')],
      [negFixture('src/n.ts', 'L1')],
    );
    const result = await derive({
      rules: [rule],
      split: splitWithTrain([1]),
      deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
    });
    expect(result.positive).toEqual([
      { pr: 1, targetRuleId: 'rule-mixed', filePath: 'src/a.ts', matchedSpan: 'L1-L2' },
    ]);
    expect(result.negative).toEqual([
      { targetRuleId: 'rule-mixed', filePath: 'src/n.ts', matchedSpan: 'L1' },
    ]);
  });
});

// ─── 7. positiveControlGate present + frozen on both policies ────────────────

describe('positiveControlGate — present + frozen (§4 / strategy#777 Q3(ii))', () => {
  it('mined gate is none, authored gate is preimage-differential', () => {
    expect(getRulePolicy('mined').positiveControlGate).toBe('none');
    expect(getRulePolicy('authored').positiveControlGate).toBe('preimage-differential');
  });

  it('the policy is frozen — a caller cannot flip the gate process-wide', () => {
    const policy = getRulePolicy('authored');
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => Object.assign(policy, { positiveControlGate: 'none' })).toThrow();
  });

  it('deriveAuthoredControls reads the (real) authored policy and completes on valid input', async () => {
    const rule = authoredRule('rule-ok', [posFixture(1, 'ch-1')]);
    const result = await derive({
      rules: [rule],
      split: splitWithTrain([1]),
      deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
    });
    expect(result.positive).toHaveLength(1);
  });
});

// ─── 8. Sidecar provenance (D1 fold #1): the builder reads ONLY provenanceByRule ──

describe('deriveAuthoredControls — sidecar provenance (D1 fold #1)', () => {
  it('throws when a rule has no provenance in provenanceByRule (sidecar miss)', async () => {
    const rule = authoredRule('rule-sidecar-miss', [posFixture(1, 'ch-1')]);
    await expect(
      deriveAuthoredControls({
        rules: [rule],
        split: splitWithTrain([1]),
        provenanceByRule: new Map(), // empty: the rule's lessonHash is absent
        deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
      }),
    ).rejects.toThrow(/no provenance in provenanceByRule/);
  });

  it('throws when the sidecar provenance is MINED, never reading rule.legitimacy', async () => {
    const rule = authoredRule('rule-sidecar-mined', [posFixture(1, 'ch-1')]);
    // The sidecar entry is MINED even though the rule's (now-ignored) legitimacy is
    // authored — proving the function reads the MAP, not rule.legitimacy.
    const minedProv: ProvenanceRecord = { mergedPr: 1, reviewThread: 'pr#1', commitSha: sha(1) };
    await expect(
      deriveAuthoredControls({
        rules: [rule],
        split: splitWithTrain([1]),
        provenanceByRule: new Map([[rule.lessonHash, minedProv]]),
        deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
      }),
    ).rejects.toThrow(/is not authored/);
  });

  it('emits from a rule with NO legitimacy — the REAL assembly-seam shape (provenance only from the map)', async () => {
    // The cert-assembly seam passes compiled rules that carry no `legitimacy` (stamped
    // post-scoring); provenance rides the `c.provenance` sidecar. Drop legitimacy here so
    // the happy path runs against that exact shape — proving the builder needs only the map.
    // `ruleNoLegit` is typed `Omit<CompiledRule, 'legitimacy'>` — the field is gone at the
    // type level (and at runtime), exactly the compiled-rule shape at the assembly seam.
    const { legitimacy, ...ruleNoLegit } = authoredRule('rule-no-legit', [posFixture(1, 'ch-1')]);
    const result = await deriveAuthoredControls({
      rules: [ruleNoLegit],
      split: splitWithTrain([1]),
      provenanceByRule: new Map([[ruleNoLegit.lessonHash, legitimacy!.provenance]]),
      deps: scriptedDeps({ 'ch-1': makeResult('differential-holds') }),
    });
    expect(result.positive).toEqual([
      { pr: 1, targetRuleId: 'rule-no-legit', filePath: 'src/a.ts', matchedSpan: 'L1-L2' },
    ]);
  });
});

// ─── Exported boundary guard (CR outside-diff): the schema must reject what the
// trichotomy makes structurally impossible, not merely admit any enum member. ──

describe('AuthoredNonEmissionSchema — outcome/class boundary guard', () => {
  const base = { targetRuleId: 'rule-x', pr: 1, outcome: 'fix-shaped', class: 'illegitimate' };

  it('accepts a well-formed non-emission (outcome → its classOf class)', () => {
    expect(AuthoredNonEmissionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects the EMITTING outcome — a non-emission can never carry differential-holds', () => {
    expect(
      AuthoredNonEmissionSchema.safeParse({ ...base, outcome: 'differential-holds' }).success,
    ).toBe(false);
  });

  it('rejects a class that contradicts its outcome (classOf mismatch)', () => {
    // needs-adjudication is `undecidable`, never `illegitimate`.
    expect(
      AuthoredNonEmissionSchema.safeParse({
        ...base,
        outcome: 'needs-adjudication',
        class: 'illegitimate',
      }).success,
    ).toBe(false);
  });
});
