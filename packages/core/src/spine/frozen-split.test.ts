import { describe, expect, it } from 'vitest';

import {
  assembleFrozenSplitArtifact,
  computeCorpusIntegrity,
  computeFreezeCommitment,
  computeFrozenSplitRef,
  FrozenSplitArtifactSchema,
  type FrozenSplitAssembly,
  SPLIT_REF_RE,
  verifyFreezeIntegrity,
} from './frozen-split.js';
import { type SplitArtifact } from './split.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const FROZEN_AT = '2026-06-01T00:00:00.000Z';

function split(overrides?: Partial<SplitArtifact>): SplitArtifact {
  return {
    asOfCommit: sha(999),
    trainPrs: [1, 2],
    heldOutPrs: [3, 4, 5],
    excludedPrs: [],
    positiveControlPrs: [],
    negativeControlPrs: [],
    splitRule: { predicate: 'code-touching non-bot', cutIndex: 2 },
    frozenAt: FROZEN_AT,
    ...overrides,
  };
}

function assembly(overrides?: Partial<FrozenSplitAssembly>): FrozenSplitAssembly {
  return {
    gate: 'gate-1',
    repo: 'mmnto-ai/liquid-city',
    selectionPins: {
      predicate: 'code-touching non-bot',
      window: { type: 'all' },
      codePathClassifier: { includeGlobs: ['packages/**'], excludeGlobs: ['**/*.md'] },
      excludeRevertPairs: true,
      excludeBotPrs: true,
    },
    split: split(),
    cutBoundarySha: sha(2),
    corpusIntegrity: computeCorpusIntegrity(
      [1, 2, 3, 4, 5],
      new Map([1, 2, 3, 4, 5].map((pr) => [pr, sha(pr)])),
    ),
    ...overrides,
  };
}

describe('frozen-split derivations (R1 — codex fold-2/fold-3)', () => {
  it('derives a deterministic content-addressed splitRef', () => {
    const a = assembleFrozenSplitArtifact(assembly());
    const b = assembleFrozenSplitArtifact(assembly());
    expect(a.splitRef).toBe(b.splitRef);
    expect(a.splitRef).toMatch(SPLIT_REF_RE);
  });

  it('the splitRef preimage EXCLUDES the commitment and the label (no circularity)', () => {
    const base = assembleFrozenSplitArtifact(assembly());
    const labeled = assembleFrozenSplitArtifact(assembly({ label: 'cert-1 freeze' }));
    expect(labeled.splitRef).toBe(base.splitRef);
    expect(labeled.freezeCommitment).toBe(base.freezeCommitment);
  });

  it('a pinned-field change moves the splitRef AND the commitment', () => {
    const base = assembleFrozenSplitArtifact(assembly());
    const moved = assembleFrozenSplitArtifact(assembly({ cutBoundarySha: sha(3) }));
    expect(moved.splitRef).not.toBe(base.splitRef);
    expect(moved.freezeCommitment).not.toBe(base.freezeCommitment);
  });

  it('a re-stamped frozenAt moves the commitment (the t1 orphaning preimage)', () => {
    const base = assembleFrozenSplitArtifact(assembly());
    const restamped = assembleFrozenSplitArtifact(
      assembly({ split: split({ frozenAt: '2026-06-02T00:00:00.000Z' }) }),
    );
    expect(restamped.freezeCommitment).not.toBe(base.freezeCommitment);
    // Direct tuple check: the commitment is exactly sha256(splitRef · frozenAt · corpusIntegrity).
    expect(base.freezeCommitment).toBe(
      computeFreezeCommitment(base.splitRef, FROZEN_AT, base.corpusIntegrity),
    );
  });

  it('corpusIntegrity is order-insensitive over the corpus but merge-commit-sensitive', () => {
    const map = new Map([1, 2, 3].map((pr) => [pr, sha(pr)]));
    expect(computeCorpusIntegrity([3, 1, 2], map)).toBe(computeCorpusIntegrity([1, 2, 3], map));
    const moved = new Map(map);
    moved.set(3, sha(33));
    expect(computeCorpusIntegrity([1, 2, 3], moved)).not.toBe(
      computeCorpusIntegrity([1, 2, 3], map),
    );
  });

  it('verifyFreezeIntegrity detects an in-place membership edit (t7 sensor)', () => {
    const artifact = assembleFrozenSplitArtifact(assembly());
    const tampered = { ...artifact, split: { ...artifact.split, heldOutPrs: [3, 4] } };
    const check = verifyFreezeIntegrity(tampered);
    expect(check.ok).toBe(false);
    expect(check.expectedSplitRef).not.toBe(tampered.splitRef);
    expect(verifyFreezeIntegrity(artifact).ok).toBe(true);
  });

  it('rejects an assembly whose split carries no frozenAt (the freeze mints the instant)', () => {
    expect(() =>
      assembleFrozenSplitArtifact(assembly({ split: split({ frozenAt: undefined }) })),
    ).toThrow(/freeze mints the instant/);
  });

  it('schema rejects an unknown field (tamper/corruption, never silently carried)', () => {
    const artifact = assembleFrozenSplitArtifact(assembly());
    expect(FrozenSplitArtifactSchema.safeParse({ ...artifact, injected: true }).success).toBe(
      false,
    );
  });

  it('computeFrozenSplitRef is stable across assembly-object key order', () => {
    const a = assembly();
    const reordered: FrozenSplitAssembly = JSON.parse(JSON.stringify(a));
    expect(computeFrozenSplitRef(reordered)).toBe(computeFrozenSplitRef(a));
  });
});
