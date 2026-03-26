import { describe, expect, it } from 'vitest';

import type { NormalizedBotFinding } from './bot-review-parser.js';
import { deduplicateFindings, extractKeywords, jaccardSimilarity } from './triage-dedup.js';

// ─── Helpers ─────────────────────────────────────────

function makeFinding(overrides: Partial<NormalizedBotFinding> = {}): NormalizedBotFinding {
  return {
    tool: 'coderabbit',
    severity: 'info',
    file: 'src/foo.ts',
    body: 'Some finding body',
    ...overrides,
  };
}

// ─── extractKeywords ─────────────────────────────────

describe('extractKeywords', () => {
  it('extracts significant words and strips stopwords', () => {
    const kw = extractKeywords('The quick brown fox jumps over the lazy dog');
    expect(kw.has('the')).toBe(false);
    expect(kw.has('quick')).toBe(true);
    expect(kw.has('brown')).toBe(true);
    expect(kw.has('over')).toBe(true); // 4 chars, not a stopword, included
  });

  it('filters words shorter than 3 characters', () => {
    const kw = extractKeywords('I am a big fan of it');
    expect(kw.has('am')).toBe(false);
    expect(kw.has('big')).toBe(true);
    expect(kw.has('fan')).toBe(true);
  });
});

// ─── jaccardSimilarity ──────────────────────────────

describe('jaccardSimilarity', () => {
  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('returns 1 for identical sets', () => {
    const s = new Set(['foo', 'bar']);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['foo', 'bar']);
    const b = new Set(['baz', 'qux']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns correct value for partial overlap', () => {
    const a = new Set(['foo', 'bar', 'baz']);
    const b = new Set(['bar', 'baz', 'qux']);
    // intersection = {bar, baz} = 2, union = {foo, bar, baz, qux} = 4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });
});

// ─── deduplicateFindings ─────────────────────────────

describe('deduplicateFindings', () => {
  it('merges findings from different bots on same file+line with same category', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        tool: 'coderabbit',
        file: 'src/auth.ts',
        line: 10,
        body: 'SQL injection risk in query builder',
      }),
      makeFinding({
        tool: 'gca',
        file: 'src/auth.ts',
        line: 10,
        body: 'Potential injection vulnerability in SQL query',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.mergedWith).toHaveLength(1);
    expect(result[0]!.mergedWith![0]!.tool).toBe('gca');
  });

  it('refuses to merge findings on the same line if triageCategory differs', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        file: 'src/foo.ts',
        line: 10,
        body: 'SQL injection risk via exec call',
      }),
      makeFinding({
        file: 'src/foo.ts',
        line: 10,
        body: 'Trailing whitespace on this line is a typo',
      }),
    ];

    const result = deduplicateFindings(findings);
    // security vs nit — should NOT merge
    expect(result).toHaveLength(2);
    expect(result[0]!.mergedWith).toBeUndefined();
    expect(result[1]!.mergedWith).toBeUndefined();
  });

  it('merges findings within +/-3 line proximity', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        file: 'src/auth.ts',
        line: 10,
        body: 'Credential leak risk in secret handling code',
      }),
      makeFinding({
        file: 'src/auth.ts',
        line: 13,
        body: 'Secret credential leak risk detected in code',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.mergedWith).toHaveLength(1);
  });

  it('does not merge findings more than 3 lines apart', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        file: 'src/auth.ts',
        line: 10,
        body: 'Credential leak risk in this function',
      }),
      makeFinding({
        file: 'src/auth.ts',
        line: 14,
        body: 'Secret credential exposed in this block',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('does not merge findings in different files', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        file: 'src/auth.ts',
        line: 10,
        body: 'SQL injection risk via exec call',
      }),
      makeFinding({
        file: 'src/db.ts',
        line: 10,
        body: 'SQL injection risk via exec call',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('handles file-level comments (no line) with high body similarity', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        file: 'src/auth.ts',
        line: undefined,
        body: 'This module has security vulnerabilities in the authentication flow',
      }),
      makeFinding({
        file: 'src/auth.ts',
        line: undefined,
        body: 'Security vulnerabilities detected in the authentication flow of this module',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.mergedWith).toHaveLength(1);
  });

  it('preserves all findings when no duplicates exist', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        file: 'src/auth.ts',
        line: 10,
        body: 'SQL injection risk via exec call',
      }),
      makeFinding({
        file: 'src/utils.ts',
        line: 50,
        body: 'Trailing whitespace is a cosmetic nit',
      }),
      makeFinding({
        file: 'src/config.ts',
        line: 5,
        body: 'Missing null check on boundary parameter',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.mergedWith).toBeUndefined();
    }
  });

  it('populates mergedWith on the primary finding', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        tool: 'coderabbit',
        file: 'src/auth.ts',
        line: 10,
        body: 'Credential leak risk in secret handling',
      }),
      makeFinding({
        tool: 'gca',
        file: 'src/auth.ts',
        line: 11,
        body: 'Secret credential leak detected here',
      }),
      makeFinding({
        tool: 'unknown',
        file: 'src/auth.ts',
        line: 12,
        body: 'Credential secret leak in this block',
      }),
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.tool).toBe('coderabbit'); // primary is the first one
    expect(result[0]!.mergedWith).toHaveLength(2);
    expect(result[0]!.dedupKey).toContain('merged:');
  });
});
