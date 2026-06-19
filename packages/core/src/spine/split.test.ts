import { describe, expect, it } from 'vitest';

import {
  resolveSplit,
  type SplitArtifact,
  SplitArtifactSchema,
  SplitCoverError,
  validateSplitCover,
} from './split.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const mcMap = (prs: number[]): Map<number, string> => new Map(prs.map((pr) => [pr, sha(pr)]));

function split(overrides?: Partial<SplitArtifact>): SplitArtifact {
  return SplitArtifactSchema.parse({
    asOfCommit: sha(100),
    trainPrs: [1, 2],
    heldOutPrs: [3, 4],
    excludedPrs: [],
    positiveControlPrs: [3],
    negativeControlPrs: [4],
    splitRule: { predicate: 'code-touching non-bot', cutIndex: 2 },
    ...overrides,
  });
}

describe('validateSplitCover', () => {
  const corpus = [1, 2, 3, 4];
  const mc = mcMap(corpus);

  it('accepts a clean three-way disjoint cover', () => {
    expect(validateSplitCover(split(), corpus, mc).ok).toBe(true);
  });

  it('flags an out-of-corpus member as FM(d) (cover.extra)', () => {
    const r = validateSplitCover(split({ heldOutPrs: [3, 4, 99] }), corpus, mcMap([...corpus, 99]));
    expect(r.cover.extra).toEqual([99]);
    expect(r.cover.missing).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it('flags a silent corpus drop as FM(g) (cover.missing)', () => {
    const r = validateSplitCover(split({ heldOutPrs: [3], negativeControlPrs: [] }), corpus, mc);
    expect(r.cover.missing).toEqual([4]);
    expect(r.cover.extra).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it('flags a train/heldOut overlap (e-split disjointness)', () => {
    const r = validateSplitCover(split({ trainPrs: [1, 2, 3], heldOutPrs: [3, 4] }), corpus, mc);
    expect(r.overlaps.trainHeldOut).toEqual([3]);
    expect(r.ok).toBe(false);
  });

  it('flags a control outside heldOut', () => {
    const r = validateSplitCover(split({ positiveControlPrs: [1] }), corpus, mc);
    expect(r.controlsOutsideHeldOut).toEqual([1]);
    expect(r.ok).toBe(false);
  });

  it('flags a PR tagged as both a positive and negative control', () => {
    const r = validateSplitCover(split({ negativeControlPrs: [3, 4] }), corpus, mc);
    expect(r.controlOverlap).toEqual([3]);
    expect(r.ok).toBe(false);
  });

  it('flags a merge-commit collision across slices', () => {
    const collide = new Map(mc);
    collide.set(3, sha(2)); // PR 3 (heldOut) collides with PR 2 (train)
    const r = validateSplitCover(split(), corpus, collide);
    expect(r.mergeCommitCollisions).toEqual([sha(2)]);
    expect(r.ok).toBe(false);
  });
});

describe('resolveSplit — forward-ancestry cut', () => {
  const corpus = [1, 2, 3, 4];

  it('puts the OLDER ancestry segment in train', () => {
    const s = resolveSplit({
      asOfCommit: sha(100),
      corpus,
      orderedNewestFirst: [4, 3, 2, 1], // newest-first; oldest-first = [1,2,3,4]
      excludedPrs: [],
      cutIndex: 2,
      positiveControlPrs: [3],
      negativeControlPrs: [4],
      predicate: 'p',
      mergeCommitByPr: mcMap(corpus),
    });
    expect(s.trainPrs).toEqual([1, 2]);
    expect(s.heldOutPrs).toEqual([3, 4]);
  });

  it('throws SplitCoverError when the result is not a clean cover', () => {
    expect(() =>
      resolveSplit({
        asOfCommit: sha(100),
        corpus,
        orderedNewestFirst: [4, 3, 2, 1],
        excludedPrs: [99], // not in corpus → an extra union member → !cover
        cutIndex: 2,
        predicate: 'p',
        mergeCommitByPr: mcMap(corpus),
      }),
    ).toThrow(SplitCoverError);
  });

  it('throws when the ancestry ordering does not cover the corpus', () => {
    expect(() =>
      resolveSplit({
        asOfCommit: sha(100),
        corpus,
        orderedNewestFirst: [4, 3, 2], // missing PR 1
        excludedPrs: [],
        cutIndex: 2,
        predicate: 'p',
        mergeCommitByPr: mcMap(corpus),
      }),
    ).toThrow(/does not cover the corpus/);
  });
});
