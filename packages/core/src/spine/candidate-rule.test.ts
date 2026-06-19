import { describe, expect, it } from 'vitest';

import { CandidateRuleRecordSchema } from './candidate-rule.js';

const sha = (n: number): string => String(n).padStart(40, '0');

function base(): Record<string, unknown> {
  return {
    provenance: { mergedPr: 1, reviewThread: 'rt-1', commitSha: sha(1) },
    classifierDisposition: 'structural',
    classifierLedgerRef: 'cl-1',
    dslSource: 'pattern: foo',
    unverified: true,
  };
}

describe('CandidateRuleRecordSchema', () => {
  it('accepts a complete unverified candidate', () => {
    expect(CandidateRuleRecordSchema.safeParse(base()).success).toBe(true);
  });

  it('rejects unverified !== true (FM b — no producer-side promotion)', () => {
    expect(CandidateRuleRecordSchema.safeParse({ ...base(), unverified: false }).success).toBe(
      false,
    );
  });

  it('rejects an incomplete provenance tuple (FM a)', () => {
    const r = base();
    delete (r.provenance as Record<string, unknown>).commitSha;
    expect(CandidateRuleRecordSchema.safeParse(r).success).toBe(false);
  });

  it('rejects an uppercase / non-canonical commit SHA', () => {
    const r = base();
    (r.provenance as Record<string, unknown>).commitSha = sha(1).toUpperCase().replace(/0/g, 'A');
    expect(CandidateRuleRecordSchema.safeParse(r).success).toBe(false);
  });

  it('rejects an empty classifierLedgerRef', () => {
    expect(
      CandidateRuleRecordSchema.safeParse({ ...base(), classifierLedgerRef: '   ' }).success,
    ).toBe(false);
  });

  it('rejects an unknown classifier disposition', () => {
    expect(
      CandidateRuleRecordSchema.safeParse({ ...base(), classifierDisposition: 'semantic' }).success,
    ).toBe(false);
  });
});
