import { describe, expect, it } from 'vitest';

import {
  assertAuthoredFreezePreconditions,
  checkFrozenBeforeAuthoring,
  checkHeldOutFloor,
  checkPositiveFixturesTrainSide,
} from './authored-freeze-gates.js';
import type { AuthoringLedgerEntry } from './authoring-ledger.js';
import type { SplitArtifact } from './split.js';

// ─── ADR-112 §5.1/§5.3 D5 — the authored freeze-time gates (Q2 floor + Q3 temporal/membership) ─

const sha = (n: number): string => String(n).padStart(40, '0');

/** A split fixture; controls empty (authored controls are train-side, not split tags). */
function split(over: Partial<SplitArtifact> = {}): SplitArtifact {
  return {
    asOfCommit: sha(1),
    trainPrs: [1, 2],
    heldOutPrs: [3, 4],
    excludedPrs: [],
    positiveControlPrs: [],
    negativeControlPrs: [],
    splitRule: { predicate: 'code-touching', cutIndex: 2 },
    frozenAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

/**
 * A ledger entry — the gates read ONLY `ruleId` / `authoredAt` / `positiveFixturePrs`, so we
 * build the read fields and cast (this is a gate-LOGIC unit test, not a schema-parse test).
 */
function entry(over: Partial<AuthoringLedgerEntry> = {}): AuthoringLedgerEntry {
  return {
    ruleId: 'rule-a',
    authoredAt: '2026-06-15T12:00:00.000Z',
    positiveFixturePrs: [1],
    ...over,
  } as AuthoringLedgerEntry;
}

describe('checkHeldOutFloor (Q2)', () => {
  it('(v) heldOut/N < 0.5 → one violation naming the ratio', () => {
    const issues = checkHeldOutFloor(split({ trainPrs: [1, 2, 3], heldOutPrs: [4] }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/1\/4 = 0\.2500 < 0\.50/);
  });

  it('(vi) heldOut/N = 0.5 exactly → PASS (inclusive)', () => {
    expect(checkHeldOutFloor(split({ trainPrs: [1, 2], heldOutPrs: [3, 4] }))).toEqual([]);
  });

  it('heldOut/N > 0.5 → PASS', () => {
    expect(checkHeldOutFloor(split({ trainPrs: [1], heldOutPrs: [2, 3] }))).toEqual([]);
  });

  it('empty window → violation (guards div-by-zero)', () => {
    const issues = checkHeldOutFloor(split({ trainPrs: [], heldOutPrs: [] }));
    expect(issues[0]).toMatch(/window is empty/);
  });
});

describe('checkFrozenBeforeAuthoring (Q3 temporal)', () => {
  it('frozen strictly before authored → PASS', () => {
    expect(
      checkFrozenBeforeAuthoring(split({ frozenAt: '2026-06-01T00:00:00.000Z' }), [
        entry({ authoredAt: '2026-06-15T12:00:00.000Z' }),
      ]),
    ).toEqual([]);
  });

  it('(ii) frozen AFTER authored → violation naming the rule + BOTH stamps', () => {
    const issues = checkFrozenBeforeAuthoring(split({ frozenAt: '2026-06-20T00:00:00.000Z' }), [
      entry({ ruleId: 'rule-late', authoredAt: '2026-06-15T12:00:00.000Z' }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('rule-late');
    expect(issues[0]).toContain('2026-06-15T12:00:00.000Z');
    expect(issues[0]).toContain('2026-06-20T00:00:00.000Z');
    expect(issues[0]).toMatch(/STRICTLY BEFORE/);
  });

  it('frozen EQUAL to authored → violation (cannot prove strictly-before)', () => {
    const t = '2026-06-15T12:00:00.000Z';
    const issues = checkFrozenBeforeAuthoring(split({ frozenAt: t }), [entry({ authoredAt: t })]);
    expect(issues).toHaveLength(1);
  });

  it('(vii) date-only authoredAt → violation (ambiguous "after"), never a silent pass', () => {
    const issues = checkFrozenBeforeAuthoring(split({ frozenAt: '2026-06-01T00:00:00.000Z' }), [
      entry({ authoredAt: '2026-06-15' }),
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/not a full ISO-8601 instant/);
  });

  it('(vii) missing frozenAt → violation (no mechanical proof possible)', () => {
    const issues = checkFrozenBeforeAuthoring(split({ frozenAt: undefined }), [entry()]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/no `frozenAt` stamp/);
  });

  it('every offending rule is surfaced (not just the first)', () => {
    const issues = checkFrozenBeforeAuthoring(split({ frozenAt: '2026-06-20T00:00:00.000Z' }), [
      entry({ ruleId: 'r1', authoredAt: '2026-06-15T00:00:00.000Z' }),
      entry({ ruleId: 'r2', authoredAt: '2026-06-16T00:00:00.000Z' }),
    ]);
    expect(issues).toHaveLength(2);
    expect(issues.join('\n')).toContain('r1');
    expect(issues.join('\n')).toContain('r2');
  });
});

describe('checkPositiveFixturesTrainSide (Q3 membership — §5.2 leakage semantics)', () => {
  const none: ReadonlySet<number> = new Set<number>();

  it('all positive fixtures train-side → PASS', () => {
    expect(
      checkPositiveFixturesTrainSide(
        split({ trainPrs: [1, 2], heldOutPrs: [3, 4] }),
        [entry({ positiveFixturePrs: [1, 2] })],
        none,
      ),
    ).toEqual([]);
  });

  it('(iii) a held-out positive fixture → violation naming rule + PR + HELD-OUT', () => {
    const issues = checkPositiveFixturesTrainSide(
      split({ trainPrs: [1], heldOutPrs: [3, 4] }),
      [entry({ ruleId: 'rule-leak', positiveFixturePrs: [3] })],
      none,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('rule-leak');
    expect(issues[0]).toContain('#3');
    expect(issues[0]).toContain('HELD-OUT');
  });

  it('a fixture outside the window, UNVERIFIED → violation ("NOT proven strictly pre-window")', () => {
    const issues = checkPositiveFixturesTrainSide(
      split({ trainPrs: [1], heldOutPrs: [3] }),
      [entry({ positiveFixturePrs: [99] })],
      none,
    );
    expect(issues[0]).toContain('NOT proven strictly pre-window');
  });

  it('a fixture outside the window, PROVEN pre-window → PASS (the #2294-couple option (a))', () => {
    expect(
      checkPositiveFixturesTrainSide(
        split({ trainPrs: [447, 601], heldOutPrs: [602, 697] }),
        [entry({ positiveFixturePrs: [422, 447] })],
        new Set([422]),
      ),
    ).toEqual([]);
  });

  it('the verified set can NEVER override held-out membership (FM (c) defense-in-depth)', () => {
    const issues = checkPositiveFixturesTrainSide(
      split({ trainPrs: [1], heldOutPrs: [3] }),
      [entry({ positiveFixturePrs: [3] })],
      new Set([3]), // a caller-fault set naming a held-out member — the gate must not honor it
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('HELD-OUT');
  });

  it('a post-window fixture (not in the verified set) → violation, the door stays shut', () => {
    // PR 999 merged after asOfCommit: the ancestry derivation cannot resolve or prove
    // it, so it is absent from the verified set and must reject.
    const issues = checkPositiveFixturesTrainSide(
      split({ trainPrs: [1], heldOutPrs: [3] }),
      [entry({ positiveFixturePrs: [999] })],
      new Set([422]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('#999');
  });
});

describe('assertAuthoredFreezePreconditions (composed, compose-never-replace)', () => {
  const none: ReadonlySet<number> = new Set<number>();

  it('(i) clean split + train-side fixtures + frozen-before → no throw', () => {
    expect(() =>
      assertAuthoredFreezePreconditions(split(), [entry({ positiveFixturePrs: [1, 2] })], none),
    ).not.toThrow();
  });

  it('(iv) both axes violate → ONE throw surfacing BOTH (not short-circuited)', () => {
    // temporal (frozen after authored) AND membership (held-out fixture) AND floor (<0.5).
    let caught: Error | undefined;
    try {
      assertAuthoredFreezePreconditions(
        split({ trainPrs: [1, 2, 3], heldOutPrs: [4], frozenAt: '2026-06-20T00:00:00.000Z' }),
        [entry({ ruleId: 'rx', authoredAt: '2026-06-15T00:00:00.000Z', positiveFixturePrs: [4] })],
        none,
      );
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    const msg = caught!.message;
    expect(msg).toMatch(/Q2 held-out floor/); // floor axis
    expect(msg).toMatch(/Q3 temporal/); // temporal axis
    expect(msg).toMatch(/Q3 membership/); // membership axis
    expect(msg).toContain('rx');
  });

  it('a proven pre-window fixture passes the composed gate (§5.2 leakage semantics)', () => {
    expect(() =>
      assertAuthoredFreezePreconditions(
        split(),
        [entry({ positiveFixturePrs: [5] })], // pr 5: outside train [1,2] ∪ heldOut [3,4]
        new Set([5]),
      ),
    ).not.toThrow();
  });

  it('surfaces a GATE_INVALID TotemError code', () => {
    let code: string | undefined;
    try {
      assertAuthoredFreezePreconditions(split({ frozenAt: undefined }), [entry()], none);
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('GATE_INVALID');
  });
});
