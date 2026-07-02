import { describe, expect, it } from 'vitest';

import { canonicalStringify } from '../compile-manifest.js';
import {
  buildWindtunnelLock,
  type CertCorpusSeed,
  CertCorpusSeedError,
  CertCorpusSeedSchema,
  deriveCorpus,
} from './cert-corpus-seed.js';
import type { PrMeta } from './selection-rule.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const sha256 = (s: string): string => s.padStart(64, '0');

/** Newest-first (git --topo-order) PrMeta, all code-touching non-bot by default. */
function meta(pr: number, overrides?: Partial<PrMeta>): PrMeta {
  return {
    pr,
    mergeCommit: sha(pr),
    author: 'Dev <dev@example.com>',
    isBotAuthor: false,
    changedFiles: ['packages/core/src/x.ts'],
    ...overrides,
  };
}

/** PRs 5,4,3,2,1 newest-first → corpus [1..5]. */
const METAS: PrMeta[] = [meta(5), meta(4), meta(3), meta(2), meta(1)];

function seed(overrides?: Partial<CertCorpusSeed>): CertCorpusSeed {
  return CertCorpusSeedSchema.parse({
    gate: 'gate-1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    repo: 'mmnto-ai/liquid-city',
    phase: 'certifying',
    selectionRule: {
      state: 'merged',
      predicate: 'code-touching non-bot non-revert',
      window: { type: 'all' },
      asOfCommit: sha(999),
      codePathClassifier: { includeGlobs: ['packages/**'], excludeGlobs: ['**/*.md'] },
    },
    split: { cutIndex: 2, excludedPrs: [] },
    controls: {
      positiveRef: '.totem/spine/gate-1/controls/positive',
      negativeRef: '.totem/spine/gate-1/controls/negative',
      mechanism: 'git-hash-object',
      positive: [{ pr: 3, targetRuleId: 'rule-abc' }],
      negative: [4],
    },
    fpDefinition: { rubricRef: 'r', groundTruthRef: 'g', adjudicator: 'disposition-derived' },
    cullRateThreshold: 0.1,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 1 },
    },
    ...overrides,
  });
}

describe('deriveCorpus', () => {
  it('derives corpus, ancestry-cut split, and held-out control roles', () => {
    const { corpus, split, prDiffRoles } = deriveCorpus({ seed: seed(), metas: METAS });

    expect(corpus).toEqual([1, 2, 3, 4, 5]);
    // cutIndex 2 → oldest 2 PRs train, remainder held-out.
    expect(split.trainPrs).toEqual([1, 2]);
    expect(split.heldOutPrs).toEqual([3, 4, 5]);
    expect(split.positiveControlPrs).toEqual([3]);
    expect(split.negativeControlPrs).toEqual([4]);

    // pr-diffs covers ONLY the held-out (scored) slice, controls tagged within it.
    expect(prDiffRoles).toEqual([
      { pr: 3, controlKind: 'positive', targetRuleId: 'rule-abc' },
      { pr: 4, controlKind: 'negative' },
      { pr: 5, controlKind: 'corpus' },
    ]);
  });

  it('excludes bot + revert PRs from the corpus (selectionRule reuse)', () => {
    const metas: PrMeta[] = [
      meta(5),
      meta(4, { isBotAuthor: true }),
      meta(3, { revertsSha: sha(2) }), // revert of #2's merge commit
      meta(2),
      meta(1),
    ];
    const { corpus, split } = deriveCorpus({
      // corpus shrinks to [1, 5] → cutIndex 1 keeps a non-empty train + held-out.
      seed: seed({
        split: { cutIndex: 1, excludedPrs: [] },
        controls: { ...seed().controls, positive: [], negative: [] },
      }),
      metas,
    });
    // #4 (bot) dropped; #3 (revert) + #2 (its target) dropped as a pair.
    expect(corpus).toEqual([1, 5]);
    expect(split.trainPrs).toEqual([1]);
    expect(split.heldOutPrs).toEqual([5]);
  });

  it('throws (Amendment-C) when a control PR is not a corpus member', () => {
    const s = seed({
      controls: { ...seed().controls, positive: [{ pr: 999, targetRuleId: 'r' }], negative: [4] },
    });
    expect(() => deriveCorpus({ seed: s, metas: METAS })).toThrow(CertCorpusSeedError);
    expect(() => deriveCorpus({ seed: s, metas: METAS })).toThrow(/not in the resolved corpus/);
  });

  it('throws on an empty corpus (no qualifying code-touching PRs)', () => {
    const docsOnly: PrMeta[] = [meta(1, { changedFiles: ['README.md'] })];
    expect(() => deriveCorpus({ seed: seed(), metas: docsOnly })).toThrow(/EMPTY corpus/);
  });
});

describe('CertCorpusSeedSchema (strict write-side, fold-1 / fold-4)', () => {
  it('rejects a positive control with no targetRuleId', () => {
    expect(() =>
      seed({
        controls: {
          ...seed().controls,
          // @ts-expect-error — exercising the runtime guard
          positive: [{ pr: 3 }],
        },
      }),
    ).toThrow();
  });

  it('rejects a PR tagged both positive and negative', () => {
    expect(() =>
      seed({
        controls: { ...seed().controls, positive: [{ pr: 3, targetRuleId: 'r' }], negative: [3] },
      }),
    ).toThrow(/BOTH positive and negative/);
  });

  it('rejects an authored seed missing split.frozenAt (presence owned at parse — strategy#804)', () => {
    expect(() => seed({ producerKind: 'authored' })).toThrow(/split\.frozenAt/);
  });

  it('accepts an authored seed carrying split.frozenAt', () => {
    const parsed = seed({
      producerKind: 'authored',
      split: { ...seed().split, frozenAt: '2026-06-01T00:00:00.000Z' },
    });
    expect(parsed.split.frozenAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it("accepts an explicit 'mined' seed without split.frozenAt (additive posture)", () => {
    expect(seed({ producerKind: 'mined' }).split.frozenAt).toBeUndefined();
  });
});

describe('buildWindtunnelLock', () => {
  const resolvedPrs = [1, 2, 3, 4, 5].map((pr) => ({
    pr,
    mergeCommit: sha(pr),
    baseSha: sha(pr + 100),
    headSha: sha(pr + 200),
  }));

  it('assembles a schema-valid lock; sorts resolvedPrs; omits llmReplaySha (two-phase)', () => {
    const lock = buildWindtunnelLock({
      seed: seed(),
      resolvedPrs: [...resolvedPrs].reverse(), // unsorted input
      integrity: { fixtureSha: sha(7), prDiffsSha: sha256('abc') },
    });
    expect(lock.corpus.resolvedPrs.map((p) => p.pr)).toEqual([1, 2, 3, 4, 5]);
    expect(lock.controls.integrity.fixtureSha).toBe(sha(7));
    expect(lock.controls.integrity.prDiffsSha).toBe(sha256('abc'));
    expect(lock.controls.integrity.llmReplaySha).toBeUndefined();
    expect(lock.fpDefinition.precisionFloor).toBe(1.0);
  });

  it('stamps llmReplaySha when supplied (the sealed phase)', () => {
    const lock = buildWindtunnelLock({
      seed: seed(),
      resolvedPrs,
      integrity: { fixtureSha: sha(7), prDiffsSha: sha256('abc'), llmReplaySha: sha256('def') },
    });
    expect(lock.controls.integrity.llmReplaySha).toBe(sha256('def'));
  });

  it('fails loud on a malformed integrity sha', () => {
    expect(() =>
      buildWindtunnelLock({
        seed: seed(),
        resolvedPrs,
        integrity: { fixtureSha: 'not-a-sha', prDiffsSha: sha256('abc') },
      }),
    ).toThrow();
  });

  // ─── D5 §7 no-blast-radius: additive-optional producerKind/authored ─────────
  it('D5: a mined lock is BYTE-IDENTICAL with the new params absent or explicitly undefined', () => {
    const base = {
      seed: seed(),
      resolvedPrs,
      integrity: { fixtureSha: sha(7), prDiffsSha: sha256('abc') },
    };
    const minedAbsent = canonicalStringify(buildWindtunnelLock(base), 2);
    const minedUndefined = canonicalStringify(
      buildWindtunnelLock({ ...base, producerKind: undefined, authored: undefined }),
      2,
    );
    // Conditional-spread ⇒ no `key: undefined` survives ⇒ byte-identical to the pre-D5 shape.
    expect(minedUndefined).toBe(minedAbsent);
    expect(minedAbsent).not.toContain('"producerKind"');
    expect(minedAbsent).not.toContain('"authored"');
  });

  it('D5: an authored lock carries producerKind + authored.expectedSplitRef (params take effect)', () => {
    const lock = buildWindtunnelLock({
      seed: seed(),
      resolvedPrs,
      integrity: { fixtureSha: sha(7), prDiffsSha: sha256('abc') },
      producerKind: 'authored',
      authored: { expectedSplitRef: 'split-cert-1' },
    });
    expect(lock.producerKind).toBe('authored');
    expect(lock.authored).toEqual({ expectedSplitRef: 'split-cert-1' });
    const authoredStr = canonicalStringify(lock, 2);
    expect(authoredStr).toContain('"producerKind"');
    expect(authoredStr).toContain('"expectedSplitRef"');
  });

  it('D5: an `authored` block without producerKind:authored fails the schema (superRefine guard)', () => {
    expect(() =>
      buildWindtunnelLock({
        seed: seed(),
        resolvedPrs,
        integrity: { fixtureSha: sha(7), prDiffsSha: sha256('abc') },
        authored: { expectedSplitRef: 'split-cert-1' },
      }),
    ).toThrow();
  });
});
