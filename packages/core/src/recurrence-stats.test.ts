import { describe, expect, it } from 'vitest';

import {
  computeSignature,
  jaccard,
  normalizeFindingBody,
  RecurrencePatternSchema,
  RecurrenceStatsSchema,
  tokenizeForJaccard,
} from './recurrence-stats.js';

// ─── RecurrencePatternSchema ───────────────────────────

describe('RecurrencePatternSchema', () => {
  it('parses a well-formed pattern', () => {
    const result = RecurrencePatternSchema.safeParse({
      signature: 'abc123def4567890',
      tool: 'coderabbit',
      severityBucket: 'medium',
      occurrences: 7,
      prs: ['101', '102'],
      sampleBodies: ['avoid using any type here', 'avoid using any type'],
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-15T00:00:00.000Z',
      paths: ['src/a.ts', 'src/b.ts'],
      coveredByRule: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects malformed pattern (missing fields)', () => {
    const result = RecurrencePatternSchema.safeParse({
      signature: 'abc',
      tool: 'coderabbit',
      // missing other fields
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown tool', () => {
    const result = RecurrencePatternSchema.safeParse({
      signature: 'abc',
      tool: 'sonarqube',
      severityBucket: 'low',
      occurrences: 1,
      prs: [],
      sampleBodies: [],
      firstSeen: 'x',
      lastSeen: 'y',
      paths: [],
      coveredByRule: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects sampleBodies > 3', () => {
    const result = RecurrencePatternSchema.safeParse({
      signature: 'abc',
      tool: 'gca',
      severityBucket: 'low',
      occurrences: 4,
      prs: ['1'],
      sampleBodies: ['a', 'b', 'c', 'd'],
      firstSeen: 'x',
      lastSeen: 'y',
      paths: [],
      coveredByRule: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('RecurrenceStatsSchema', () => {
  it('parses an empty stats document', () => {
    const result = RecurrenceStatsSchema.safeParse({
      version: 1,
      lastUpdated: '2026-04-28T00:00:00.000Z',
      thresholdApplied: 5,
      historyDepth: 50,
      prsScanned: [],
      patterns: [],
      coveredPatterns: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-1 version', () => {
    const result = RecurrenceStatsSchema.safeParse({
      version: 2,
      lastUpdated: 'x',
      thresholdApplied: 5,
      historyDepth: 50,
      prsScanned: [],
      patterns: [],
      coveredPatterns: [],
    });
    expect(result.success).toBe(false);
  });
});

// ─── normalizeFindingBody ──────────────────────────────

describe('normalizeFindingBody', () => {
  it('strips file paths with line:col suffix', () => {
    const body = 'Avoid using `any` in packages/cli/src/foo.ts:42:7 and src/bar.ts:10';
    const out = normalizeFindingBody(body);
    expect(out).not.toContain('packages/cli/src/foo.ts');
    expect(out).not.toContain('src/bar.ts');
    expect(out).not.toMatch(/:42/);
    expect(out).not.toMatch(/:10\b/);
  });

  it('strips standalone line references', () => {
    const out = normalizeFindingBody('See line 42 and Line: 100 below');
    expect(out).not.toContain('line 42');
    expect(out).not.toContain('line: 100');
    expect(out).not.toMatch(/\bline\b/);
  });

  it('strips triple-backtick fenced code', () => {
    const body = 'Wrap this:\n```ts\nconst x: any = 1;\n```\nUse a real type.';
    const out = normalizeFindingBody(body);
    expect(out).not.toContain('const x');
    expect(out).not.toContain('```');
    expect(out).toContain('use a real type');
  });

  it('strips backtick-spans', () => {
    const out = normalizeFindingBody('Avoid `any` here, prefer `unknown`.');
    expect(out).not.toContain('`');
    expect(out).toContain('avoid');
    expect(out).toContain('prefer');
  });

  it('strips URLs', () => {
    const out = normalizeFindingBody(
      'See https://github.com/mmnto-ai/totem/issues/1715 for context.',
    );
    expect(out).not.toContain('https://');
    expect(out).not.toContain('github.com');
  });

  it('strips leading severity prefix `CRITICAL: `', () => {
    const out = normalizeFindingBody('CRITICAL: shell injection risk in handler.');
    expect(out.startsWith('shell')).toBe(true);
  });

  it('strips leading bold severity prefix `**Critical**`', () => {
    const out = normalizeFindingBody('**Critical** shell injection risk.');
    expect(out.startsWith('shell')).toBe(true);
  });

  it('lowercases and collapses internal whitespace', () => {
    const out = normalizeFindingBody('Avoid    USING\n\n  ANY    TYPE');
    expect(out).toBe('avoid using any type');
  });

  it('produces the same normalized output for path/line variants', () => {
    const a = normalizeFindingBody(
      'Avoid using `any` in packages/cli/src/foo.ts:42 — prefer unknown.',
    );
    const b = normalizeFindingBody(
      'Avoid using `any` in packages/core/src/bar.ts:99 — prefer unknown.',
    );
    expect(a).toBe(b);
  });
});

// ─── computeSignature ──────────────────────────────────

describe('computeSignature', () => {
  it('is deterministic for the same input', () => {
    const sig1 = computeSignature('avoid using any type');
    const sig2 = computeSignature('avoid using any type');
    expect(sig1).toBe(sig2);
  });

  it('produces a 16-char hex string', () => {
    const sig = computeSignature('hello world');
    expect(sig).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs for distinct inputs', () => {
    const a = computeSignature('avoid using any type');
    const b = computeSignature('avoid using let');
    expect(a).not.toBe(b);
  });
});

// ─── tokenizeForJaccard ────────────────────────────────

describe('tokenizeForJaccard', () => {
  it('drops tokens of length <= 2', () => {
    const toks = tokenizeForJaccard('a bb ccc dddd');
    expect(toks.has('a')).toBe(false);
    expect(toks.has('bb')).toBe(false);
    expect(toks.has('ccc')).toBe(true);
    expect(toks.has('dddd')).toBe(true);
  });

  it('drops stopwords', () => {
    const toks = tokenizeForJaccard('the use of any using');
    expect(toks.has('the')).toBe(false);
    expect(toks.has('use')).toBe(false);
    expect(toks.has('using')).toBe(false);
    expect(toks.has('any')).toBe(true);
  });

  it('lowercases tokens', () => {
    const toks = tokenizeForJaccard('Avoid USING ANY TYPE');
    expect(toks.has('avoid')).toBe(true);
    expect(toks.has('any')).toBe(true);
    expect(toks.has('type')).toBe(true);
  });

  it('splits on non-alphanumeric characters', () => {
    const toks = tokenizeForJaccard('avoid-using/any.type');
    expect(toks.has('avoid')).toBe(true);
    expect(toks.has('any')).toBe(true);
    expect(toks.has('type')).toBe(true);
  });
});

// ─── jaccard ───────────────────────────────────────────

describe('jaccard', () => {
  it('returns 1.0 for identical non-empty sets', () => {
    const a = new Set(['avoid', 'any', 'type']);
    const b = new Set(['avoid', 'any', 'type']);
    expect(jaccard(a, b)).toBe(1);
  });

  it('returns 0.0 for disjoint sets', () => {
    const a = new Set(['foo', 'bar']);
    const b = new Set(['baz', 'qux']);
    expect(jaccard(a, b)).toBe(0);
  });

  it('returns 0.0 for two empty sets', () => {
    const a = new Set<string>();
    const b = new Set<string>();
    expect(jaccard(a, b)).toBe(0);
  });

  it('is symmetric', () => {
    const a = new Set(['avoid', 'any', 'type', 'unknown']);
    const b = new Set(['avoid', 'any', 'prefer']);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });

  it('returns a value strictly between 0 and 1 for partial overlap', () => {
    const a = new Set(['avoid', 'any', 'type']);
    const b = new Set(['avoid', 'any', 'prefer']);
    const v = jaccard(a, b);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    // |intersection| = 2, |union| = 4 → 0.5
    expect(v).toBeCloseTo(0.5, 5);
  });
});
