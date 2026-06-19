import { describe, expect, it } from 'vitest';

import { type FmClause, runFalsificationHarness } from './miner-harness.js';

const sha = (n: number): string => String(n).padStart(40, '0');

/**
 * A contract-clean miner run: corpus [1,2,3,4], train [1,2] (both emitted),
 * heldOut [3,4] (controls 3/4), no drops, no held-out fetches, seed-blind.
 */
function greenLedgers() {
  return {
    emission: {
      entries: [
        {
          candidateRef: 'c1',
          provenance: { mergedPr: 1, reviewThread: 'rt-1', commitSha: sha(1) },
          classifierDisposition: 'structural',
          routing: 'compile',
          classifierLedgerRef: 'cl-1',
          unverified: true,
        },
        {
          candidateRef: 'c2',
          provenance: { mergedPr: 2, reviewThread: 'rt-2', commitSha: sha(2) },
          classifierDisposition: 'structural',
          routing: 'compile',
          classifierLedgerRef: 'cl-2',
          unverified: true,
        },
      ],
      extractionInputsAttestation: { seedClassesProvided: false },
    },
    drop: { entries: [] },
    classifier: {
      entries: [
        { candidateRef: 'cl-1', disposition: 'structural', stage4Confirmed: true },
        { candidateRef: 'cl-2', disposition: 'structural', stage4Confirmed: true },
      ],
    },
    split: {
      split: {
        asOfCommit: sha(100),
        trainPrs: [1, 2],
        heldOutPrs: [3, 4],
        excludedPrs: [],
        positiveControlPrs: [3],
        negativeControlPrs: [4],
        splitRule: { predicate: 'code-touching non-bot', cutIndex: 2 },
      },
      corpus: [1, 2, 3, 4],
      corpusMergeCommits: [1, 2, 3, 4].map((pr) => ({ pr, mergeCommit: sha(pr) })),
    },
    apiUsage: {
      entries: [
        { targetPr: 1, slice: 'train', fetchKind: 'review-thread' },
        { targetPr: 2, slice: 'train', fetchKind: 'review-thread' },
      ],
      heldOutFetchCount: 0,
    },
  };
}

// Deep clone via JSON so mutations don't bleed across cases (no Dates/fns here).
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Distinct FM clauses the harness reports for a raw ledger object, sorted. */
function clauses(raw: unknown): FmClause[] {
  const r = runFalsificationHarness(raw);
  return [...new Set(r.violations.map((v) => v.clause))].sort();
}

describe('runFalsificationHarness — green', () => {
  it('passes a contract-clean miner run (no FM clause holds)', () => {
    const r = runFalsificationHarness(greenLedgers());
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
});

describe('runFalsificationHarness — each red fixture fails on EXACTLY its clause', () => {
  it('(a) incomplete provenance tuple', () => {
    const g = clone(greenLedgers());
    delete (g.emission.entries[0].provenance as Record<string, unknown>).commitSha;
    expect(clauses(g)).toEqual(['a']);
  });

  it('(b) candidate minted non-unverified', () => {
    const g = clone(greenLedgers());
    g.emission.entries[0].unverified = false;
    expect(clauses(g)).toEqual(['b']);
  });

  it('(c) behavioral candidate routed to compile', () => {
    const g = clone(greenLedgers());
    g.emission.entries[0].classifierDisposition = 'behavioral';
    expect(clauses(g)).toEqual(['c']);
  });

  it('(d) out-of-corpus split member', () => {
    const g = clone(greenLedgers());
    g.split.split.heldOutPrs = [3, 4, 99];
    g.split.corpusMergeCommits.push({ pr: 99, mergeCommit: sha(99) });
    expect(clauses(g)).toEqual(['d']);
  });

  it('(e-split) control outside heldOut (slice disjointness)', () => {
    const g = clone(greenLedgers());
    g.split.split.positiveControlPrs = [1]; // a train PR, not in heldOut
    expect(clauses(g)).toEqual(['e-split']);
  });

  it('(e-emission) candidate sourced from a held-out PR', () => {
    const g = clone(greenLedgers());
    g.emission.entries.push({
      candidateRef: 'c3',
      provenance: { mergedPr: 3, reviewThread: 'rt-3', commitSha: sha(3) }, // PR 3 is held-out
      classifierDisposition: 'structural',
      routing: 'compile',
      classifierLedgerRef: 'cl-3',
      unverified: true,
    });
    g.classifier.entries.push({
      candidateRef: 'cl-3',
      disposition: 'structural',
      stage4Confirmed: true,
    });
    expect(clauses(g)).toEqual(['e-emission']);
  });

  it('(f) seed class supplied to extraction', () => {
    const g = clone(greenLedgers());
    g.emission.extractionInputsAttestation.seedClassesProvided = true;
    expect(clauses(g)).toEqual(['f']);
  });

  it('(g) silent corpus drop', () => {
    const g = clone(greenLedgers());
    g.split.split.heldOutPrs = [3];
    g.split.split.negativeControlPrs = [];
    expect(clauses(g)).toEqual(['g']);
  });

  it('(h) held-out content fetch', () => {
    const g = clone(greenLedgers());
    g.apiUsage.heldOutFetchCount = 1;
    expect(clauses(g)).toEqual(['h']);
  });

  it('(i) train PR processed by neither emission nor drop', () => {
    const g = clone(greenLedgers());
    g.emission.entries.pop(); // remove the PR 2 candidate, do not drop it either
    g.classifier.entries.pop();
    expect(clauses(g)).toEqual(['i']);
  });
});
