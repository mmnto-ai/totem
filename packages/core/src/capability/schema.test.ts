import { describe, expect, it } from 'vitest';

import {
  CapabilityClaimSchema,
  CapabilityResolutionSchema,
  deriveClaimId,
  ResolutionSourceSchema,
} from './schema.js';

const sha = (n: number): string => String(n).padStart(40, '0');

const baseClaimIdInput = {
  agentSource: 'cr',
  taskType: 'review-catch' as const,
  claimKind: 'review-finding',
  provenanceRef: 'mmnto-ai/totem#2205',
  commitSha: sha(1),
  nativeKey: 'gh-review-comment:111',
};

describe('deriveClaimId', () => {
  it('is stable + deterministic for identical identity fields', () => {
    expect(deriveClaimId(baseClaimIdInput)).toBe(deriveClaimId({ ...baseClaimIdInput }));
    // 64-char sha256 hex
    expect(deriveClaimId(baseClaimIdInput)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes on each identity field (no collisions across nativeKey/claimKind/agentSource)', () => {
    const base = deriveClaimId(baseClaimIdInput);
    expect(deriveClaimId({ ...baseClaimIdInput, nativeKey: 'gh-review-comment:222' })).not.toBe(
      base,
    );
    expect(deriveClaimId({ ...baseClaimIdInput, claimKind: 'other-kind' })).not.toBe(base);
    expect(deriveClaimId({ ...baseClaimIdInput, agentSource: 'gca' })).not.toBe(base);
    expect(deriveClaimId({ ...baseClaimIdInput, commitSha: sha(2) })).not.toBe(base);
    expect(deriveClaimId({ ...baseClaimIdInput, provenanceRef: 'x#1' })).not.toBe(base);
  });
});

describe('ResolutionSourceSchema (FM-b is structural)', () => {
  it('accepts the four authority classes', () => {
    for (const s of [
      'deterministic-event',
      'disposition-thread',
      'frozen-label',
      'operator-tiebreak',
    ]) {
      expect(ResolutionSourceSchema.parse(s)).toBe(s);
    }
  });

  it('has NO llm-judge member — an LLM-judged resolution is unconstructible', () => {
    expect(ResolutionSourceSchema.safeParse('llm-judge').success).toBe(false);
    expect(ResolutionSourceSchema.options).not.toContain('llm-judge');
  });
});

describe('CapabilityClaimSchema', () => {
  const valid = {
    claimId: 'abc',
    agentSource: 'cr',
    taskType: 'review-catch',
    claimKind: 'review-finding',
    provenance: { ref: 'mmnto-ai/totem#2205', commitSha: sha(1) },
    nativeKey: 'gh-review-comment:111',
    assertedAt: '2026-06-20T00:00:00.000Z',
  };

  it('parses a valid claim and rejects a non-SHA commit + empty fields', () => {
    expect(CapabilityClaimSchema.safeParse(valid).success).toBe(true);
    expect(
      CapabilityClaimSchema.safeParse({
        ...valid,
        provenance: { ref: 'x', commitSha: 'not-a-sha' },
      }).success,
    ).toBe(false);
    expect(CapabilityClaimSchema.safeParse({ ...valid, agentSource: '  ' }).success).toBe(false);
  });

  it('rejects a malformed assertedAt — date-only, offset, or empty (greptile P2)', () => {
    expect(CapabilityClaimSchema.safeParse({ ...valid, assertedAt: '2026-06-20' }).success).toBe(
      false,
    );
    expect(
      CapabilityClaimSchema.safeParse({ ...valid, assertedAt: '2026-06-20T12:00:00+00:00' })
        .success,
    ).toBe(false);
    expect(CapabilityClaimSchema.safeParse({ ...valid, assertedAt: '' }).success).toBe(false);
  });
});

describe('CapabilityResolutionSchema', () => {
  const valid = {
    resolutionId: 'rc-res:111',
    claimId: 'abc',
    outcome: 'correct',
    resolutionSource: 'disposition-thread',
    evidenceRef: 'gh-review-comment:111',
    resolvedAt: '2026-06-20T00:00:00.000Z',
  };

  it('parses a valid resolution and rejects a bad outcome', () => {
    expect(CapabilityResolutionSchema.safeParse(valid).success).toBe(true);
    expect(CapabilityResolutionSchema.safeParse({ ...valid, outcome: 'maybe' }).success).toBe(
      false,
    );
  });

  it('accepts an optional supersedesResolutionId', () => {
    expect(
      CapabilityResolutionSchema.safeParse({ ...valid, supersedesResolutionId: 'rc-res:110' })
        .success,
    ).toBe(true);
  });

  it('rejects a malformed resolvedAt — date-only (greptile P2)', () => {
    expect(
      CapabilityResolutionSchema.safeParse({ ...valid, resolvedAt: '2026-06-20' }).success,
    ).toBe(false);
  });

  it('rejects an empty/whitespace supersedesResolutionId — ghost pointer (CR)', () => {
    expect(
      CapabilityResolutionSchema.safeParse({ ...valid, supersedesResolutionId: '' }).success,
    ).toBe(false);
    expect(
      CapabilityResolutionSchema.safeParse({ ...valid, supersedesResolutionId: '   ' }).success,
    ).toBe(false);
  });
});
