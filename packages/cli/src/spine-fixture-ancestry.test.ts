import { describe, expect, it } from 'vitest';

import { verifyPreWindowFixturePrs } from './spine-fixture-ancestry.js';

// ─── ADR-112 §5.2 — the pre-window ancestry derivation (#2294 couple, option (a)) ─

const sha = (n: number): string => String(n).padStart(40, 'a');

const BOUNDARY_ANCESTORS = new Set([sha(422), sha(34)]);

function derive(over: Partial<Parameters<typeof verifyPreWindowFixturePrs>[0]> = {}) {
  return verifyPreWindowFixturePrs({
    fixturePrs: [422, 34, 447, 602, 999],
    trainPrs: [447, 601],
    heldOutPrs: [602, 697],
    mergeCommitByPr: new Map([
      [422, sha(422)],
      [34, sha(34)],
      [447, sha(447)],
      [602, sha(602)],
      [999, sha(999)], // resolvable but NOT an ancestor (merged after the boundary)
    ]),
    isAncestorOfCutBoundary: (mc) => BOUNDARY_ANCESTORS.has(mc),
    ...over,
  });
}

describe('verifyPreWindowFixturePrs (§5.2 leakage semantics)', () => {
  it('admits ONLY out-of-window PRs whose merge commit is an ancestor of the cut boundary', () => {
    expect([...derive()].sort((a, b) => a - b)).toEqual([34, 422]);
  });

  it('never contains train members (they need no proof) or held-out members (FM (c))', () => {
    const verified = derive();
    expect(verified.has(447)).toBe(false);
    expect(verified.has(602)).toBe(false);
  });

  it('a post-window PR (resolvable, NOT an ancestor) is excluded — the door stays shut', () => {
    expect(derive().has(999)).toBe(false);
  });

  it('an unresolvable PR (absent from the enumeration, e.g. merged after asOfCommit) is excluded', () => {
    const verified = derive({ fixturePrs: [12345] });
    expect(verified.size).toBe(0);
  });

  it('PR-number order is IRRELEVANT — a low-numbered PR that is not an ancestor is excluded', () => {
    // The ancestry-not-PR-number subtlety: a long-lived low-number PR merged late.
    const verified = derive({
      fixturePrs: [5],
      mergeCommitByPr: new Map([[5, sha(5)]]), // resolvable; sha(5) is NOT in the ancestor set
    });
    expect(verified.has(5)).toBe(false);
  });

  it('duplicate fixture declarations resolve once (set semantics)', () => {
    const calls: string[] = [];
    const verified = verifyPreWindowFixturePrs({
      fixturePrs: [422, 422, 422],
      trainPrs: [447],
      heldOutPrs: [602],
      mergeCommitByPr: new Map([[422, sha(422)]]),
      isAncestorOfCutBoundary: (mc) => {
        calls.push(mc);
        return true;
      },
    });
    expect(verified.has(422)).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
