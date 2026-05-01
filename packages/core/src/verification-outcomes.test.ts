import { describe, expect, it } from 'vitest';

import {
  Stage4OutcomeStored,
  VerificationOutcomeEntrySchema,
  VerificationOutcomesFileSchema,
} from './verification-outcomes.js';

// ─── Stage4OutcomeStored ───────────────────────────

describe('Stage4OutcomeStored', () => {
  it('accepts each Stage4Outcome literal', () => {
    for (const outcome of [
      'no-matches',
      'out-of-scope',
      'in-scope-bad-example',
      'candidate-debt',
    ] as const) {
      expect(Stage4OutcomeStored.parse(outcome)).toBe(outcome);
    }
  });

  it('rejects an unknown literal', () => {
    expect(() => Stage4OutcomeStored.parse('promoted')).toThrow();
  });
});

// ─── VerificationOutcomeEntrySchema ────────────────

describe('VerificationOutcomeEntrySchema', () => {
  const validEntry = {
    ruleHash: 'abc123',
    verifiedAt: '2026-05-01T12:34:56.000Z',
    outcome: 'in-scope-bad-example' as const,
    baselineMatches: [],
    inScopeMatches: ['src/foo.ts'],
    candidateDebtLines: [],
  };

  it('accepts a fully-populated valid entry', () => {
    const parsed = VerificationOutcomeEntrySchema.parse(validEntry);
    expect(parsed.ruleHash).toBe('abc123');
    expect(parsed.outcome).toBe('in-scope-bad-example');
    expect(parsed.inScopeMatches).toEqual(['src/foo.ts']);
  });

  it('defaults match arrays to empty when omitted', () => {
    const parsed = VerificationOutcomeEntrySchema.parse({
      ruleHash: 'abc123',
      verifiedAt: '2026-05-01T12:34:56.000Z',
      outcome: 'no-matches',
    });
    expect(parsed.baselineMatches).toEqual([]);
    expect(parsed.inScopeMatches).toEqual([]);
    expect(parsed.candidateDebtLines).toEqual([]);
  });

  it('rejects invalid verification-outcomes schema payloads', () => {
    expect(() => VerificationOutcomeEntrySchema.parse({ ...validEntry, ruleHash: '' })).toThrow();
    expect(() => VerificationOutcomeEntrySchema.parse({ ...validEntry, ruleHash: 42 })).toThrow();
    expect(() =>
      VerificationOutcomeEntrySchema.parse({ ...validEntry, verifiedAt: 'not-a-date' }),
    ).toThrow();
    expect(() =>
      VerificationOutcomeEntrySchema.parse({ ...validEntry, outcome: 'promoted' }),
    ).toThrow();
    expect(() =>
      VerificationOutcomeEntrySchema.parse({ ...validEntry, ruleHash: '   ' }),
    ).toThrow();
    expect(() =>
      VerificationOutcomeEntrySchema.parse({ ...validEntry, inScopeMatches: [''] }),
    ).toThrow();
    const { ruleHash: _omit, ...missingHash } = validEntry;
    void _omit;
    expect(() => VerificationOutcomeEntrySchema.parse(missingHash)).toThrow();
  });

  it('trims surrounding whitespace from ruleHash', () => {
    const parsed = VerificationOutcomeEntrySchema.parse({ ...validEntry, ruleHash: '  abc123  ' });
    expect(parsed.ruleHash).toBe('abc123');
  });
});

// ─── VerificationOutcomesFileSchema ────────────────

describe('VerificationOutcomesFileSchema', () => {
  const validEntry = {
    ruleHash: 'abc123',
    verifiedAt: '2026-05-01T12:34:56.000Z',
    outcome: 'in-scope-bad-example' as const,
    baselineMatches: [],
    inScopeMatches: [],
    candidateDebtLines: [],
  };

  it('accepts an empty outcomes record with default version', () => {
    const parsed = VerificationOutcomesFileSchema.parse({ outcomes: {} });
    expect(parsed.version).toBe(1);
    expect(parsed.outcomes).toEqual({});
  });

  it('accepts a populated outcomes record', () => {
    const parsed = VerificationOutcomesFileSchema.parse({
      version: 1,
      outcomes: { abc123: validEntry },
    });
    expect(parsed.outcomes['abc123']?.outcome).toBe('in-scope-bad-example');
  });

  it('rejects a future schema version', () => {
    expect(() =>
      VerificationOutcomesFileSchema.parse({
        version: 2,
        outcomes: { abc123: validEntry },
      }),
    ).toThrow();
  });

  it('rejects a malformed nested entry', () => {
    expect(() =>
      VerificationOutcomesFileSchema.parse({
        version: 1,
        outcomes: { abc123: { ...validEntry, outcome: 'promoted' } },
      }),
    ).toThrow();
  });
});
