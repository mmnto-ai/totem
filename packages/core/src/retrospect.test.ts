import { describe, expect, it } from 'vitest';

import { toSeverityBucket } from './recurrence-stats.js';
import {
  buildStopConditions,
  classifyFinding,
  computeDedupRate,
  groupFindingsByRound,
  RETROSPECT_ROUTE_OUT_REASONS,
  type RetrospectClassification,
  RetrospectClassificationSchema,
  type RetrospectFinding,
  RetrospectFindingSchema,
  type RetrospectReport,
  RetrospectReportSchema,
  type RetrospectReviewSubmission,
  RetrospectRoundSchema,
  signatureOfBody,
  toCrossPrBucket,
  toRoundPosition,
} from './retrospect.js';

// ─── Helpers ───────────────────────────────────────────

function makeFinding(overrides: Partial<RetrospectFinding>): RetrospectFinding {
  return {
    signature: '0123456789abcdef',
    tool: 'coderabbit',
    severityBucket: 'medium',
    bodyExcerpt: 'a finding',
    file: 'src/x.ts',
    line: 10,
    roundNumber: 1,
    crossPrRecurrence: 0,
    coveredByRule: false,
    classification: 'in-pr-fix',
    ...overrides,
  };
}

// ─── Schemas ──────────────────────────────────────────

describe('RetrospectRoundSchema', () => {
  it('parses a well-formed round', () => {
    const result = RetrospectRoundSchema.safeParse({
      roundNumber: 1,
      submittedAt: '2026-04-29T00:00:00.000Z',
      headSha: 'abc123',
      findingCount: 4,
    });
    expect(result.success).toBe(true);
  });

  it('rejects roundNumber < 1', () => {
    const result = RetrospectRoundSchema.safeParse({
      roundNumber: 0,
      submittedAt: 'x',
      findingCount: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a missing headSha', () => {
    const result = RetrospectRoundSchema.safeParse({
      roundNumber: 2,
      submittedAt: '2026-04-29T00:00:00.000Z',
      findingCount: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe('RetrospectClassificationSchema', () => {
  it.each(['route-out', 'in-pr-fix', 'undetermined'] as const)(
    'accepts %s',
    (v: RetrospectClassification) => {
      expect(RetrospectClassificationSchema.safeParse(v).success).toBe(true);
    },
  );

  it('rejects unknown classification', () => {
    expect(RetrospectClassificationSchema.safeParse('block').success).toBe(false);
  });
});

describe('RetrospectFindingSchema', () => {
  it('parses a route-out finding with reason', () => {
    const result = RetrospectFindingSchema.safeParse(
      makeFinding({
        classification: 'route-out',
        routeOutReason: RETROSPECT_ROUTE_OUT_REASONS.COVERED_BY_RULE,
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects negative crossPrRecurrence', () => {
    const result = RetrospectFindingSchema.safeParse(makeFinding({ crossPrRecurrence: -1 }));
    expect(result.success).toBe(false);
  });
});

describe('RetrospectReportSchema', () => {
  it('parses a minimal empty report', () => {
    const empty: RetrospectReport = {
      version: 1,
      prNumber: '1713',
      prState: 'open',
      generatedAt: '2026-04-29T00:00:00.000Z',
      threshold: 5,
      substrateAvailable: false,
      compiledRulesAvailable: false,
      rounds: [],
      totalFindings: 0,
      dedupRate: 0,
      findingDistribution: { byTool: {}, bySeverity: {}, byClassification: {} },
      routeOutCandidates: [],
      inPrFixes: [],
      undetermined: [],
      stopConditions: [],
      overrideEventsObserved: 0,
    };
    expect(RetrospectReportSchema.safeParse(empty).success).toBe(true);
  });

  it('rejects version != 1', () => {
    const bad = {
      version: 2,
      prNumber: '1',
      prState: 'open',
      generatedAt: 'x',
      threshold: 5,
      substrateAvailable: false,
      compiledRulesAvailable: false,
      rounds: [],
      totalFindings: 0,
      dedupRate: 0,
      findingDistribution: { byTool: {}, bySeverity: {}, byClassification: {} },
      routeOutCandidates: [],
      inPrFixes: [],
      undetermined: [],
      stopConditions: [],
      overrideEventsObserved: 0,
    };
    expect(RetrospectReportSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── toRoundPosition / toCrossPrBucket ─────────────────

describe('toRoundPosition', () => {
  it.each([
    [1, 'early'],
    [3, 'early'],
    [4, 'mid'],
    [9, 'mid'],
    [10, 'late'],
    [50, 'late'],
  ] as const)('round %i → %s', (round, expected) => {
    expect(toRoundPosition(round)).toBe(expected);
  });
});

describe('toCrossPrBucket', () => {
  it.each([
    [0, 'none'],
    [1, 'some'],
    [2, 'some'],
    [3, 'frequent'],
    [99, 'frequent'],
  ] as const)('crossPrRecurrence %i → %s', (n, expected) => {
    expect(toCrossPrBucket(n)).toBe(expected);
  });
});

// ─── classifyFinding (table-driven cube) ──────────────

describe('classifyFinding', () => {
  // Exhaustive cube over (severity, roundPosition-anchor, crossPrRecurrence-anchor, coveredByRule).
  // Each row encodes the EXPECTED outcome for the bucket combination,
  // not the literal round number — we pick a representative round per
  // bucket (early=2, mid=6, late=12) and a representative recurrence
  // count per bucket (none=0, some=1, frequent=5).
  const cube: ReadonlyArray<
    readonly [
      'critical' | 'high' | 'medium' | 'low' | 'nit',
      number, // roundNumber
      number, // crossPrRecurrence
      boolean, // coveredByRule
      RetrospectClassification,
    ]
  > = [
    // critical / high — always in-pr-fix regardless of other axes.
    ['critical', 2, 0, false, 'in-pr-fix'],
    ['critical', 12, 5, true, 'in-pr-fix'],
    ['high', 2, 0, false, 'in-pr-fix'],
    ['high', 12, 5, true, 'in-pr-fix'],

    // medium — late + covered → route-out; else in-pr-fix.
    ['medium', 12, 0, true, 'route-out'],
    ['medium', 12, 0, false, 'in-pr-fix'],
    ['medium', 6, 0, true, 'in-pr-fix'],
    ['medium', 2, 0, false, 'in-pr-fix'],

    // low / nit early/mid — in-pr-fix unless rule-covered (low only).
    ['low', 2, 0, false, 'in-pr-fix'],
    ['low', 6, 0, false, 'in-pr-fix'],
    ['low', 2, 0, true, 'route-out'],
    ['nit', 2, 0, false, 'in-pr-fix'],
    ['nit', 6, 0, true, 'in-pr-fix'], // nit early/mid never routes out via coverage

    // low / nit late — route-out via covered, frequent, or LOW_NIT_LATE default.
    ['low', 12, 0, true, 'route-out'],
    ['low', 12, 5, false, 'route-out'],
    ['low', 12, 0, false, 'route-out'],
    ['nit', 12, 0, true, 'route-out'],
    ['nit', 12, 5, false, 'route-out'],
    ['nit', 12, 0, false, 'route-out'],
  ];

  it.each(cube)(
    'severity=%s round=%i crossPr=%i covered=%s → %s',
    (severityBucket, roundNumber, crossPrRecurrence, coveredByRule, expected) => {
      const out = classifyFinding({
        severityBucket,
        roundNumber,
        crossPrRecurrence,
        coveredByRule,
      });
      expect(out.classification).toBe(expected);
    },
  );

  it('emits COVERED_BY_RULE reason when low/nit late + covered', () => {
    const out = classifyFinding({
      severityBucket: 'low',
      roundNumber: 12,
      crossPrRecurrence: 0,
      coveredByRule: true,
    });
    expect(out.routeOutReason).toBe(RETROSPECT_ROUTE_OUT_REASONS.COVERED_BY_RULE);
  });

  it('emits FREQUENT_CROSS_PR reason when low/nit late + frequent uncovered', () => {
    const out = classifyFinding({
      severityBucket: 'nit',
      roundNumber: 12,
      crossPrRecurrence: 5,
      coveredByRule: false,
    });
    expect(out.routeOutReason).toBe(RETROSPECT_ROUTE_OUT_REASONS.FREQUENT_CROSS_PR);
  });

  it('emits LOW_NIT_LATE reason when low/nit late, uncovered, not frequent', () => {
    const out = classifyFinding({
      severityBucket: 'low',
      roundNumber: 12,
      crossPrRecurrence: 1,
      coveredByRule: false,
    });
    expect(out.routeOutReason).toBe(RETROSPECT_ROUTE_OUT_REASONS.LOW_NIT_LATE);
  });

  it('emits RULE_COVERED_LATE reason when medium late + covered', () => {
    const out = classifyFinding({
      severityBucket: 'medium',
      roundNumber: 12,
      crossPrRecurrence: 0,
      coveredByRule: true,
    });
    expect(out.routeOutReason).toBe(RETROSPECT_ROUTE_OUT_REASONS.RULE_COVERED_LATE);
  });

  it('returns no reason on in-pr-fix verdict', () => {
    const out = classifyFinding({
      severityBucket: 'critical',
      roundNumber: 1,
      crossPrRecurrence: 0,
      coveredByRule: false,
    });
    expect(out.routeOutReason).toBeUndefined();
  });

  it('is deterministic — same inputs yield identical outputs across calls', () => {
    const input = {
      severityBucket: 'medium' as const,
      roundNumber: 12,
      crossPrRecurrence: 0,
      coveredByRule: true,
    };
    const a = classifyFinding(input);
    const b = classifyFinding(input);
    const c = classifyFinding(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

// ─── groupFindingsByRound ─────────────────────────────

describe('groupFindingsByRound', () => {
  it('collapses two reviews on the same head_sha into one round', () => {
    const submissions: RetrospectReviewSubmission[] = [
      {
        id: 1,
        commit_id: 'sha-A',
        submitted_at: '2026-04-29T01:00:00.000Z',
        user_login: 'coderabbit[bot]',
      },
      {
        id: 2,
        commit_id: 'sha-A',
        submitted_at: '2026-04-29T01:30:00.000Z',
        user_login: 'gemini-code-assist[bot]',
      },
    ];
    const counts = new Map<string, number>([['sha-A', 4]]);
    const rounds = groupFindingsByRound(submissions, counts);

    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.roundNumber).toBe(1);
    expect(rounds[0]!.headSha).toBe('sha-A');
    expect(rounds[0]!.findingCount).toBe(4);
    // Earliest of the two timestamps.
    expect(rounds[0]!.submittedAt).toBe('2026-04-29T01:00:00.000Z');
  });

  it('separates reviews on different head_sha into distinct rounds', () => {
    const submissions: RetrospectReviewSubmission[] = [
      { id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z', user_login: 'cr' },
      { id: 2, commit_id: 'sha-B', submitted_at: '2026-04-29T02:00:00.000Z', user_login: 'cr' },
      { id: 3, commit_id: 'sha-C', submitted_at: '2026-04-29T03:00:00.000Z', user_login: 'cr' },
    ];
    const counts = new Map<string, number>([
      ['sha-A', 1],
      ['sha-B', 2],
      ['sha-C', 3],
    ]);
    const rounds = groupFindingsByRound(submissions, counts);

    expect(rounds).toHaveLength(3);
    expect(rounds.map((r) => r.headSha)).toEqual(['sha-A', 'sha-B', 'sha-C']);
    expect(rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3]);
    expect(rounds.map((r) => r.findingCount)).toEqual([1, 2, 3]);
  });

  it('orders rounds by EARLIEST submitted_at per SHA', () => {
    // sha-B first by timestamp, even though sha-A appears earlier in the array.
    const submissions: RetrospectReviewSubmission[] = [
      { id: 10, commit_id: 'sha-A', submitted_at: '2026-04-29T05:00:00.000Z', user_login: 'cr' },
      { id: 11, commit_id: 'sha-B', submitted_at: '2026-04-29T01:00:00.000Z', user_login: 'cr' },
    ];
    const counts = new Map<string, number>();
    const rounds = groupFindingsByRound(submissions, counts);

    expect(rounds[0]!.headSha).toBe('sha-B');
    expect(rounds[1]!.headSha).toBe('sha-A');
  });

  it('buckets reviews missing commit_id into a single synthetic round', () => {
    const submissions: RetrospectReviewSubmission[] = [
      { id: 1, commit_id: null, submitted_at: '2026-04-29T01:00:00.000Z', user_login: 'cr' },
      { id: 2, submitted_at: '2026-04-29T01:30:00.000Z', user_login: 'cr' },
    ];
    const counts = new Map<string, number>([['', 2]]);
    const rounds = groupFindingsByRound(submissions, counts);

    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.headSha).toBeUndefined();
    expect(rounds[0]!.findingCount).toBe(2);
  });

  it('returns an empty array when no submissions are provided', () => {
    expect(groupFindingsByRound([], new Map())).toEqual([]);
  });

  it('handles a single submission with one finding', () => {
    const submissions: RetrospectReviewSubmission[] = [
      { id: 1, commit_id: 'sha-X', submitted_at: '2026-04-29T01:00:00.000Z', user_login: 'cr' },
    ];
    const counts = new Map<string, number>([['sha-X', 1]]);
    const rounds = groupFindingsByRound(submissions, counts);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.findingCount).toBe(1);
  });
});

// ─── buildStopConditions ──────────────────────────────

describe('buildStopConditions', () => {
  function reportShell(
    over: Partial<RetrospectReport>,
  ): Pick<
    RetrospectReport,
    'rounds' | 'routeOutCandidates' | 'inPrFixes' | 'dedupRate' | 'findingDistribution'
  > {
    return {
      rounds: [],
      routeOutCandidates: [],
      inPrFixes: [],
      dedupRate: 0,
      findingDistribution: { byTool: {}, bySeverity: {}, byClassification: {} },
      ...over,
    };
  }

  it('emits nothing on a totally empty report', () => {
    expect(buildStopConditions(reportShell({}))).toEqual([]);
  });

  it('emits the route-out follow-up suggestion with N=1 when one route-out candidate exists', () => {
    const conditions = buildStopConditions(
      reportShell({
        routeOutCandidates: [makeFinding({ classification: 'route-out' })],
      }),
    );
    expect(conditions[0]).toContain('1 follow-up issue(s)');
  });

  it('emits the route-out follow-up suggestion with N=3 when three exist', () => {
    const conditions = buildStopConditions(
      reportShell({
        routeOutCandidates: [
          makeFinding({ classification: 'route-out', signature: 'a' }),
          makeFinding({ classification: 'route-out', signature: 'b' }),
          makeFinding({ classification: 'route-out', signature: 'c' }),
        ],
      }),
    );
    expect(conditions[0]).toContain('3 follow-up issue(s)');
  });

  it('emits the rule-covered ratio suggestion when ≥ 50% of last round is covered', () => {
    const lastRoundFindings = [
      makeFinding({
        roundNumber: 12,
        coveredByRule: true,
        classification: 'route-out',
        signature: 'a',
      }),
      makeFinding({
        roundNumber: 12,
        coveredByRule: true,
        classification: 'route-out',
        signature: 'b',
      }),
      makeFinding({
        roundNumber: 12,
        coveredByRule: false,
        classification: 'in-pr-fix',
        signature: 'c',
      }),
    ];
    const conditions = buildStopConditions(
      reportShell({
        rounds: [
          {
            roundNumber: 12,
            submittedAt: '2026-04-29T00:00:00.000Z',
            findingCount: lastRoundFindings.length,
          },
        ],
        routeOutCandidates: lastRoundFindings.filter((f) => f.classification === 'route-out'),
        // inPrFixes is referenced inside buildStopConditions via the
        // composed search; report shape here intentionally minimal
        // because the helper only reads `routeOutCandidates +
        // inPrFixes` for the ratio check.
      } as Partial<RetrospectReport>),
    );
    // The substring "covered by compiled rules" is the deterministic
    // template fragment.
    expect(conditions.some((c) => c.includes('covered by compiled rules'))).toBe(true);
  });

  it('does NOT emit the rule-covered ratio suggestion when < 50% of last round is covered', () => {
    const conditions = buildStopConditions(
      reportShell({
        rounds: [{ roundNumber: 12, submittedAt: '2026-04-29T00:00:00.000Z', findingCount: 4 }],
        routeOutCandidates: [
          makeFinding({ roundNumber: 12, coveredByRule: false, classification: 'route-out' }),
        ],
      }),
    );
    expect(conditions.find((c) => c.includes('covered by compiled rules'))).toBeUndefined();
  });

  it('emits the frequent-cross-PR suggestion only when ≥ 1 route-out has frequent recurrence', () => {
    const withFrequent = buildStopConditions(
      reportShell({
        routeOutCandidates: [
          makeFinding({ classification: 'route-out', crossPrRecurrence: 5, signature: 'a' }),
        ],
      }),
    );
    expect(withFrequent.some((c) => c.includes('recur across other PRs'))).toBe(true);

    const withoutFrequent = buildStopConditions(
      reportShell({
        routeOutCandidates: [
          makeFinding({ classification: 'route-out', crossPrRecurrence: 1, signature: 'b' }),
        ],
      }),
    );
    expect(withoutFrequent.find((c) => c.includes('recur across other PRs'))).toBeUndefined();
  });

  it('emits the dedup-rate suggestion when dedupRate ≥ 0.4', () => {
    const conditions = buildStopConditions(
      reportShell({
        dedupRate: 0.5,
        rounds: [{ roundNumber: 1, submittedAt: 'x', findingCount: 0 }],
      }),
    );
    expect(conditions.some((c) => c.includes('high dedup rate'))).toBe(true);
  });

  it('does NOT emit the dedup-rate suggestion when dedupRate < 0.4', () => {
    const conditions = buildStopConditions(
      reportShell({
        dedupRate: 0.1,
        rounds: [{ roundNumber: 1, submittedAt: 'x', findingCount: 0 }],
      }),
    );
    expect(conditions.find((c) => c.includes('high dedup rate'))).toBeUndefined();
  });
});

// ─── computeDedupRate ─────────────────────────────────

describe('computeDedupRate', () => {
  it('returns 0 on zero findings', () => {
    expect(computeDedupRate([])).toBe(0);
  });

  it('returns 0 when all signatures are unique', () => {
    expect(computeDedupRate([{ signature: 'a' }, { signature: 'b' }, { signature: 'c' }])).toBe(0);
  });

  it('returns 1 - 1/N when all findings share one signature', () => {
    const dup = [{ signature: 'a' }, { signature: 'a' }, { signature: 'a' }, { signature: 'a' }];
    // 1 unique / 4 total → dedupRate = 0.75
    expect(computeDedupRate(dup)).toBeCloseTo(0.75, 6);
  });

  it('returns the mid value for partial duplication', () => {
    // 2 unique / 4 total → 0.5
    expect(
      computeDedupRate([
        { signature: 'a' },
        { signature: 'a' },
        { signature: 'b' },
        { signature: 'b' },
      ]),
    ).toBeCloseTo(0.5, 6);
  });

  it('clamps to [0, 1]', () => {
    const r = computeDedupRate([{ signature: 'x' }]);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

// ─── signatureOfBody (cross-substrate parity) ─────────

describe('signatureOfBody', () => {
  it('returns identical 16-char signatures for path/line variants', () => {
    const a = signatureOfBody('Avoid using `any` in src/foo.ts:42 — prefer `unknown`.');
    const b = signatureOfBody('Avoid using `any` in src/bar.ts:99 — prefer `unknown`.');
    expect(a).toBe(b);
    expect(a.length).toBe(16);
  });

  it('returns different signatures for genuinely different findings', () => {
    const a = signatureOfBody('Avoid using `any` — prefer `unknown`.');
    const b = signatureOfBody('Empty catch block.');
    expect(a).not.toBe(b);
  });
});

// ─── toSeverityBucket reused from recurrence-stats ───

describe('toSeverityBucket (re-used from recurrence-stats — single source of truth)', () => {
  it.each([
    ['coderabbit' as const, 'critical', 'critical'],
    ['coderabbit' as const, 'major', 'high'],
    ['coderabbit' as const, 'minor', 'medium'],
    ['coderabbit' as const, 'whatever', 'low'],
    ['gca' as const, 'high', 'high'],
    ['gca' as const, 'medium', 'medium'],
    ['gca' as const, 'low', 'low'],
    ['gca' as const, 'unknown', 'low'],
    ['override' as const, 'anything', 'medium'],
    // SARIF v2.1.0 §3.27.10 result.level vocabulary — explicit branch added for mmnto-ai/totem#1734 review-1.
    ['sarif' as const, 'error', 'high'],
    ['sarif' as const, 'warning', 'medium'],
    ['sarif' as const, 'note', 'low'],
    ['sarif' as const, 'none', 'low'],
    ['sarif' as const, 'unknown', 'low'],
    ['unknown' as const, 'critical', 'critical'],
    ['unknown' as const, 'major', 'high'],
    ['unknown' as const, 'warning', 'medium'],
    ['unknown' as const, 'info', 'low'],
    ['unknown' as const, 'whatever', 'nit'],
  ] as const)('tool=%s severity=%s → %s', (tool, severity, expected) => {
    expect(toSeverityBucket(tool, severity)).toBe(expected);
  });
});
