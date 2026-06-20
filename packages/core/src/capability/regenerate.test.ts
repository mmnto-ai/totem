import { describe, expect, it } from 'vitest';

import { canonicalStringify } from '../compile-manifest.js';
import { regenerateCapabilityLedger } from './regenerate.js';
import type { CapabilityClaim, CapabilityResolution } from './schema.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const HORIZON = '2026-06-20T12:00:00.000Z';

function claim(
  id: string,
  agentSource = 'cr',
  overrides: Partial<CapabilityClaim> = {},
): CapabilityClaim {
  return {
    claimId: id,
    agentSource,
    taskType: 'review-catch',
    claimKind: 'review-finding',
    provenance: { ref: `mmnto-ai/totem#${id}`, commitSha: sha(1) },
    nativeKey: `gh-review-comment:${id}`,
    assertedAt: '2026-06-19T00:00:00.000Z',
    ...overrides,
  };
}

function resolution(
  id: string,
  claimId: string,
  outcome: CapabilityResolution['outcome'],
  overrides: Partial<CapabilityResolution> = {},
): CapabilityResolution {
  return {
    resolutionId: id,
    claimId,
    outcome,
    resolutionSource: 'disposition-thread',
    evidenceRef: `ev:${id}`,
    resolvedAt: '2026-06-19T06:00:00.000Z',
    ...overrides,
  };
}

const row = (ledger: ReturnType<typeof regenerateCapabilityLedger>, agent: string) =>
  ledger.rows.find((r) => r.agentSource === agent);

describe('regenerateCapabilityLedger — fold + hit-rate', () => {
  it('counts held/wrong/partial/silence and computes hitRate = correct/(correct+wrong)', () => {
    const claims = [claim('1'), claim('2'), claim('3'), claim('4')];
    const resolutions = [
      resolution('r1', '1', 'correct'),
      resolution('r2', '2', 'wrong'),
      resolution('r3', '3', 'partial'),
      // claim 4 has no resolution → unresolved by absence
    ];
    const ledger = regenerateCapabilityLedger(claims, resolutions, { resolutionHorizon: HORIZON });
    const cr = row(ledger, 'cr')!;
    expect(cr.correctN).toBe(1);
    expect(cr.wrongN).toBe(1);
    expect(cr.partialN).toBe(1);
    expect(cr.unresolvedN).toBe(1);
    expect(cr.decisiveN).toBe(2); // partial + unresolved excluded
    expect(cr.hitRate).toBe(0.5); // 1/(1+1)
  });

  it('hitRate is null when there is no decisive evidence (never 0/0)', () => {
    const ledger = regenerateCapabilityLedger(
      [claim('1'), claim('2')],
      [resolution('r1', '1', 'partial')], // claim 2 unresolved
      { resolutionHorizon: HORIZON },
    );
    expect(row(ledger, 'cr')!.hitRate).toBeNull();
    expect(row(ledger, 'cr')!.decisiveN).toBe(0);
  });

  it('divides the cohort by actor-id (the acceptance shape)', () => {
    const claims = [claim('1', 'cr'), claim('2', 'cr'), claim('3', 'gca'), claim('4', 'gca')];
    const resolutions = [
      resolution('r1', '1', 'correct'),
      resolution('r2', '2', 'correct'),
      resolution('r3', '3', 'correct'),
      resolution('r4', '4', 'wrong'),
    ];
    const ledger = regenerateCapabilityLedger(claims, resolutions, { resolutionHorizon: HORIZON });
    expect(row(ledger, 'cr')!.hitRate).toBe(1); // 2/2
    expect(row(ledger, 'gca')!.hitRate).toBe(0.5); // 1/2
  });

  it('excludes immature resolutions past the horizon (near-HEAD skew fix)', () => {
    const ledger = regenerateCapabilityLedger(
      [claim('1')],
      [resolution('r1', '1', 'wrong', { resolvedAt: '2026-06-21T00:00:00.000Z' })], // > horizon
      { resolutionHorizon: HORIZON },
    );
    expect(row(ledger, 'cr')!.unresolvedN).toBe(1);
    expect(row(ledger, 'cr')!.decisiveN).toBe(0);
  });
});

describe('regenerateCapabilityLedger — supersession', () => {
  it('selects the terminal of a supersedesResolutionId chain', () => {
    const ledger = regenerateCapabilityLedger(
      [claim('1')],
      [
        resolution('r1', '1', 'correct', { resolvedAt: '2026-06-19T01:00:00.000Z' }),
        resolution('r2', '1', 'wrong', {
          resolvedAt: '2026-06-19T02:00:00.000Z',
          supersedesResolutionId: 'r1',
        }),
      ],
      { resolutionHorizon: HORIZON },
    );
    expect(row(ledger, 'cr')!.wrongN).toBe(1); // r2 (terminal) wins
    expect(row(ledger, 'cr')!.correctN).toBe(0);
  });

  it('falls back to latest resolvedAt when there is no chain', () => {
    const ledger = regenerateCapabilityLedger(
      [claim('1')],
      [
        resolution('r1', '1', 'wrong', { resolvedAt: '2026-06-19T01:00:00.000Z' }),
        resolution('r2', '1', 'correct', { resolvedAt: '2026-06-19T05:00:00.000Z' }),
      ],
      { resolutionHorizon: HORIZON },
    );
    expect(row(ledger, 'cr')!.correctN).toBe(1); // latest (r2) wins
  });
});

describe('regenerateCapabilityLedger — FM-c join integrity (fail loud)', () => {
  it('throws on a resolution referencing an absent claim', () => {
    expect(() =>
      regenerateCapabilityLedger([claim('1')], [resolution('r9', 'NOPE', 'correct')], {
        resolutionHorizon: HORIZON,
      }),
    ).toThrow(/references absent claim/);
  });

  it('throws on a duplicate resolutionId', () => {
    expect(() =>
      regenerateCapabilityLedger(
        [claim('1'), claim('2')],
        [resolution('dup', '1', 'correct'), resolution('dup', '2', 'wrong')],
        { resolutionHorizon: HORIZON },
      ),
    ).toThrow(/duplicate resolutionId/);
  });

  it('throws on an ambiguous supersession terminal (two unsuperseded heads)', () => {
    expect(() =>
      regenerateCapabilityLedger(
        [claim('1')],
        [
          resolution('r1', '1', 'correct', { supersedesResolutionId: 'r0' }),
          resolution('r2', '1', 'wrong', { supersedesResolutionId: 'rx' }),
        ],
        { resolutionHorizon: HORIZON },
      ),
    ).toThrow(/ambiguous terminal/);
  });
});

describe('regenerateCapabilityLedger — FM-a byte reproducibility + ordering', () => {
  it('regenerates byte-identically and sorts rows by (agentSource, taskType)', () => {
    const claims = [claim('2', 'gca'), claim('1', 'cr')];
    const resolutions = [resolution('r1', '1', 'correct'), resolution('r2', '2', 'wrong')];
    const a = regenerateCapabilityLedger(claims, resolutions, { resolutionHorizon: HORIZON });
    const b = regenerateCapabilityLedger([...claims].reverse(), [...resolutions].reverse(), {
      resolutionHorizon: HORIZON,
    });
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(a.rows.map((r) => r.agentSource)).toEqual(['cr', 'gca']); // sorted
  });
});
