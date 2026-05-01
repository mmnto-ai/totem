import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from './test-utils.js';
import {
  readVerificationOutcomes,
  Stage4OutcomeStored,
  VerificationOutcomeEntrySchema,
  VerificationOutcomesFileSchema,
  type VerificationOutcomesStore,
  writeVerificationOutcomes,
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

// ─── Persistence (mmnto-ai/totem#1684 T2) ───────────

describe('readVerificationOutcomes / writeVerificationOutcomes', () => {
  let tmpDir!: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-vouts-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function tmpFile(name = 'verification-outcomes.json'): string {
    return path.join(tmpDir, name);
  }

  const sampleStore: VerificationOutcomesStore = {
    abc123: {
      ruleHash: 'abc123',
      verifiedAt: '2026-05-01T12:34:56.000Z',
      outcome: 'in-scope-bad-example',
      baselineMatches: [],
      inScopeMatches: ['src/foo.ts', 'src/bar.ts'],
      candidateDebtLines: [],
    },
    def456: {
      ruleHash: 'def456',
      verifiedAt: '2026-05-01T12:35:00.000Z',
      outcome: 'candidate-debt',
      baselineMatches: [],
      inScopeMatches: ['src/baz.ts'],
      candidateDebtLines: ['src/baz.ts:10:something'],
    },
  };

  it('returns an empty store when the file does not exist', () => {
    const warnings: string[] = [];
    const store = readVerificationOutcomes(tmpFile('absent.json'), (m) => warnings.push(m));
    expect(store).toEqual({});
    expect(warnings).toEqual([]);
  });

  it('writes verification outcomes atomically and creates missing directories', () => {
    const filePath = path.join(tmpFile('nested'), 'deep', 'verification-outcomes.json');
    expect(fs.existsSync(path.dirname(filePath))).toBe(false);
    writeVerificationOutcomes(filePath, sampleStore);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
    const roundTripped = readVerificationOutcomes(filePath);
    expect(roundTripped).toEqual(sampleStore);
  });

  it('round-trips the sample store byte-stably', () => {
    const filePath = tmpFile();
    writeVerificationOutcomes(filePath, sampleStore);
    const firstBytes = fs.readFileSync(filePath, 'utf-8');
    writeVerificationOutcomes(filePath, sampleStore);
    const secondBytes = fs.readFileSync(filePath, 'utf-8');
    expect(secondBytes).toBe(firstBytes);
  });

  it('canonicalizes object key order regardless of insertion order', () => {
    const filePath = tmpFile();
    writeVerificationOutcomes(filePath, sampleStore);
    const firstBytes = fs.readFileSync(filePath, 'utf-8');

    const reordered: VerificationOutcomesStore = {
      def456: sampleStore['def456']!,
      abc123: sampleStore['abc123']!,
    };
    writeVerificationOutcomes(filePath, reordered);
    const secondBytes = fs.readFileSync(filePath, 'utf-8');
    expect(secondBytes).toBe(firstBytes);
  });

  it('returns an empty store and warns on malformed JSON', () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, '{ this is : not json,', 'utf-8');
    const warnings: string[] = [];
    const store = readVerificationOutcomes(filePath, (m) => warnings.push(m));
    expect(store).toEqual({});
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Malformed JSON/);
  });

  it('returns an empty store and warns on schema mismatch', () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, JSON.stringify({ version: 2, outcomes: {} }), 'utf-8');
    const warnings: string[] = [];
    const store = readVerificationOutcomes(filePath, (m) => warnings.push(m));
    expect(store).toEqual({});
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Schema validation failed/);
  });

  it('overwrites a prior corrupt file on next write', () => {
    const filePath = tmpFile();
    fs.writeFileSync(filePath, 'garbage{', 'utf-8');
    expect(readVerificationOutcomes(filePath, () => {})).toEqual({});
    writeVerificationOutcomes(filePath, sampleStore);
    expect(readVerificationOutcomes(filePath)).toEqual(sampleStore);
  });
});
