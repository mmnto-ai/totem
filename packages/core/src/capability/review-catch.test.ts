import { describe, expect, it } from 'vitest';

import { regenerateCapabilityLedger } from './regenerate.js';
import { type MinedReviewFinding, mineReviewCatch, resolveActorId } from './review-catch.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const HORIZON = '2026-06-21T00:00:00.000Z';

function finding(
  overrides: Partial<MinedReviewFinding> & { commentId: number },
): MinedReviewFinding {
  return {
    author: 'coderabbitai[bot]',
    prRef: 'mmnto-ai/totem#2205',
    commitSha: sha(1),
    assertedAt: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveActorId — couple to the registries, do not mint', () => {
  it('maps the three active review-bot logins to their stable actor-ids', () => {
    expect(resolveActorId('coderabbitai[bot]')).toBe('coderabbit');
    expect(resolveActorId('gemini-code-assist[bot]')).toBe('gemini-code-assist');
    expect(resolveActorId('greptile-apps[bot]')).toBe('greptile');
  });

  it('does NOT specially map dropped/research-only backends (pr-agent/qodo)', () => {
    // No shipped #670 registry to couple to — they fall through to the raw login.
    expect(resolveActorId('pr-agent[bot]')).toBe('pr-agent[bot]');
    expect(resolveActorId('qodo[bot]')).toBe('qodo[bot]');
  });

  it('does NOT collapse an unknown bot variant into a shipped actor-id — exact match (greptile P2)', () => {
    // A future `greptile-enterprise[bot]` must NOT become `greptile` (would mix hit-rates).
    expect(resolveActorId('greptile-enterprise[bot]')).toBe('greptile-enterprise[bot]');
    expect(resolveActorId('coderabbit-premium[bot]')).toBe('coderabbit-premium[bot]');
  });

  it('throws on an empty/whitespace author login (fail loud — GCA)', () => {
    expect(() => resolveActorId('')).toThrow(/non-empty/);
    expect(() => resolveActorId('   ')).toThrow(/non-empty/);
  });

  it('keeps a cohort seat login as its own actor-id', () => {
    expect(resolveActorId('totem-claude')).toBe('totem-claude');
    expect(resolveActorId('strategy-codex')).toBe('strategy-codex');
  });
});

describe('mineReviewCatch — held/wrong/silence', () => {
  it('accepted → a correct resolution; declined → a wrong resolution', () => {
    const { claims, resolutions } = mineReviewCatch([
      finding({ commentId: 111, disposition: 'accepted' }),
      finding({ commentId: 222, disposition: 'declined' }),
    ]);
    expect(claims).toHaveLength(2);
    expect(resolutions).toHaveLength(2);
    expect(
      resolutions.find((r) => r.evidenceRef.includes('111') || r.claimId === claims[0]!.claimId)
        ?.outcome,
    ).toBe('correct');
    expect(resolutions.every((r) => r.resolutionSource === 'disposition-thread')).toBe(true); // FM-b
  });

  it('silence (no disposition) emits NO resolution → unresolved by absence', () => {
    const { claims, resolutions } = mineReviewCatch([finding({ commentId: 333 })]);
    expect(claims).toHaveLength(1);
    expect(resolutions).toHaveLength(0);
    const ledger = regenerateCapabilityLedger(claims, resolutions, { resolutionHorizon: HORIZON });
    expect(ledger.rows[0]!.unresolvedN).toBe(1);
    expect(ledger.rows[0]!.decisiveN).toBe(0);
  });

  it('claimId is stable across re-mining and independent of assertedAt (identity ≠ content)', () => {
    const a = mineReviewCatch([
      finding({ commentId: 111, assertedAt: '2026-06-20T00:00:00.000Z' }),
    ]);
    const b = mineReviewCatch([
      finding({ commentId: 111, assertedAt: '2026-06-25T09:09:09.000Z' }),
    ]);
    expect(a.claims[0]!.claimId).toBe(b.claims[0]!.claimId); // assertedAt excluded from claimId
  });

  it('two findings on the same PR get distinct claims (nativeKey discriminator)', () => {
    const { claims } = mineReviewCatch([finding({ commentId: 111 }), finding({ commentId: 222 })]);
    expect(claims[0]!.claimId).not.toBe(claims[1]!.claimId);
  });
});

describe('mineReviewCatch → regenerate — end-to-end division', () => {
  it('produces a per-actor hit-rate division from review findings', () => {
    const { claims, resolutions } = mineReviewCatch([
      finding({ commentId: 1, author: 'coderabbitai[bot]', disposition: 'accepted' }),
      finding({ commentId: 2, author: 'coderabbitai[bot]', disposition: 'accepted' }),
      finding({ commentId: 3, author: 'gemini-code-assist[bot]', disposition: 'accepted' }),
      finding({ commentId: 4, author: 'gemini-code-assist[bot]', disposition: 'declined' }),
      finding({ commentId: 5, author: 'totem-claude', disposition: 'accepted' }),
    ]);
    const ledger = regenerateCapabilityLedger(claims, resolutions, { resolutionHorizon: HORIZON });
    const byAgent = Object.fromEntries(ledger.rows.map((r) => [r.agentSource, r.hitRate]));
    expect(byAgent.coderabbit).toBe(1); // 2/2
    expect(byAgent['gemini-code-assist']).toBe(0.5); // 1/2
    expect(byAgent['totem-claude']).toBe(1); // 1/1
  });
});
