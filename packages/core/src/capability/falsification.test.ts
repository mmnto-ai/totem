import { describe, expect, it } from 'vitest';

import { runCapabilityFalsification } from './falsification.js';
import { mineReviewCatch } from './review-catch.js';
import type { CapabilityClaim, CapabilityResolution } from './schema.js';

const sha = (n: number): string => String(n).padStart(40, '0');
const HORIZON = '2026-06-21T00:00:00.000Z';

const minedLog = () =>
  mineReviewCatch([
    {
      commentId: 1,
      author: 'coderabbitai[bot]',
      prRef: 'x#1',
      commitSha: sha(1),
      assertedAt: '2026-06-20T00:00:00.000Z',
      disposition: 'accepted',
    },
    {
      commentId: 2,
      author: 'gemini-code-assist[bot]',
      prRef: 'x#1',
      commitSha: sha(1),
      assertedAt: '2026-06-20T00:00:00.000Z',
      disposition: 'declined',
    },
    {
      commentId: 3,
      author: 'totem-claude',
      prRef: 'x#1',
      commitSha: sha(1),
      assertedAt: '2026-06-20T00:00:00.000Z',
    },
  ]);

describe('runCapabilityFalsification', () => {
  it('passes a clean mined log (FM a/c/d all hold)', () => {
    const { claims, resolutions } = minedLog();
    const result = runCapabilityFalsification(claims, resolutions, { resolutionHorizon: HORIZON });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('flags FM-c when a resolution references an absent claim', () => {
    const { claims } = minedLog();
    const orphan: CapabilityResolution = {
      resolutionId: 'r-orphan',
      claimId: 'does-not-exist',
      outcome: 'correct',
      resolutionSource: 'disposition-thread',
      evidenceRef: 'ev',
      resolvedAt: '2026-06-20T00:00:00.000Z',
    };
    const result = runCapabilityFalsification(claims, [orphan], { resolutionHorizon: HORIZON });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.clause)).toContain('c');
  });

  it('flags FM-c on a duplicate resolutionId', () => {
    const claims: CapabilityClaim[] = [
      {
        claimId: 'c1',
        agentSource: 'cr',
        taskType: 'review-catch',
        claimKind: 'review-finding',
        provenance: { ref: 'x#1', commitSha: sha(1) },
        nativeKey: 'gh-review-comment:1',
        assertedAt: '2026-06-20T00:00:00.000Z',
      },
      {
        claimId: 'c2',
        agentSource: 'cr',
        taskType: 'review-catch',
        claimKind: 'review-finding',
        provenance: { ref: 'x#1', commitSha: sha(1) },
        nativeKey: 'gh-review-comment:2',
        assertedAt: '2026-06-20T00:00:00.000Z',
      },
    ];
    const dup: CapabilityResolution[] = [
      {
        resolutionId: 'same',
        claimId: 'c1',
        outcome: 'correct',
        resolutionSource: 'deterministic-event',
        evidenceRef: 'e1',
        resolvedAt: '2026-06-20T00:00:00.000Z',
      },
      {
        resolutionId: 'same',
        claimId: 'c2',
        outcome: 'wrong',
        resolutionSource: 'deterministic-event',
        evidenceRef: 'e2',
        resolvedAt: '2026-06-20T00:00:00.000Z',
      },
    ];
    const result = runCapabilityFalsification(claims, dup, { resolutionHorizon: HORIZON });
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.clause)).toContain('c');
  });
});
