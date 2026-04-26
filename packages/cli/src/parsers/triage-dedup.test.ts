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

// ─── deduplicateFindings (mmnto-ai/totem#1666 — strict-by-id) ──────────

describe('deduplicateFindings', () => {
  // ─── Strict-by-id semantics ─────────────────────────

  it('reproduces the LC#80 R3 exhibit: 6 distinct rootCommentIds on the same file:line surface as 6 entries', () => {
    // Pre-#1666 the proximity + Jaccard fuzzy merge collapsed all 6 into
    // one entry. Strict-by-id keeps them distinct because each comment
    // carries a unique GitHub-assigned ID, regardless of how similar
    // the bodies look or how identical the (file, line) anchor is.
    const findings: NormalizedBotFinding[] = [
      {
        tool: 'gca',
        severity: 'high',
        file: '.totem/compiled-rules.json',
        line: 598,
        body: 'SystemParam rule severity should be `error` not `warning`',
        rootCommentId: 1001,
      },
      {
        tool: 'gca',
        severity: 'high',
        file: '.totem/compiled-rules.json',
        line: 598,
        body: 'SystemParam rule fileGlobs missing test/spec exclusions',
        rootCommentId: 1002,
      },
      {
        tool: 'gca',
        severity: 'high',
        file: '.totem/compiled-rules.json',
        line: 598,
        body: 'init_resource rule fileGlobs missing test/spec exclusions',
        rootCommentId: 1003,
      },
      {
        tool: 'gca',
        severity: 'high',
        file: '.totem/compiled-rules.json',
        line: 598,
        body: 'SystemParam rule goodExample non-compilable Rust lifetimes',
        rootCommentId: 1004,
      },
      {
        tool: 'gca',
        severity: 'high',
        file: '.totem/compiled-rules.json',
        line: 598,
        body: 'archivedReason `\\b` JSON-escape typo',
        rootCommentId: 1005,
      },
      {
        tool: 'gca',
        severity: 'high',
        file: '.totem/compiled-rules.json',
        line: 598,
        body: 'lesson-a00d6b65 missing from compiled-rules.json',
        rootCommentId: 1006,
      },
    ];

    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(6);
    expect(result.map((r) => r.rootCommentId)).toEqual([1001, 1002, 1003, 1004, 1005, 1006]);
  });

  it('keeps findings with distinct rootCommentIds even when bodies are byte-identical', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: 'src/auth.ts', line: 10, body: 'Missing semicolon', rootCommentId: 200 }),
      makeFinding({ file: 'src/auth.ts', line: 10, body: 'Missing semicolon', rootCommentId: 201 }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('drops the second finding when two share the same rootCommentId (API duplicate)', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ body: 'first', rootCommentId: 999 }),
      makeFinding({ body: 'second (duplicate id)', rootCommentId: 999 }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe('first'); // first-seen wins
  });

  // ─── Cross-bot independence (strategy bot-nuance pattern 1) ──────

  it('keeps cross-bot findings distinct on the same file:line — agreement is signal, not noise', () => {
    // Pre-#1666 the fuzzy merge collapsed CR + GCA findings on similar
    // bodies into one entry, masking exactly the cross-bot agreement
    // signal the strategy bot-nuance file documents as elevated-
    // confidence. Strict-by-id surfaces both so the triage agent reads
    // the convergence.
    const findings: NormalizedBotFinding[] = [
      makeFinding({
        tool: 'coderabbit',
        file: 'src/auth.ts',
        line: 10,
        body: 'SQL injection risk in query builder',
        rootCommentId: 300,
      }),
      makeFinding({
        tool: 'gca',
        file: 'src/auth.ts',
        line: 10,
        body: 'Potential injection vulnerability in SQL query',
        rootCommentId: 301,
      }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.tool).sort()).toEqual(['coderabbit', 'gca']);
  });

  // ─── Body-hash fallback (synthesized review-body findings) ──────

  it('dedupes review-body findings with identical (file, body) when rootCommentId is absent', () => {
    // extractReviewBodyFindings emits findings with file === '(review body)'
    // and no rootCommentId. The fallback path uses (file, body) as the
    // dedup primitive.
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: '(review body)', body: 'Outside-diff finding text' }),
      makeFinding({ file: '(review body)', body: 'Outside-diff finding text' }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
  });

  it('keeps review-body findings distinct when bodies differ', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: '(review body)', body: 'First synthesized finding' }),
      makeFinding({ file: '(review body)', body: 'Second synthesized finding' }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('does not merge a synthesized finding with an inline finding even when bodies match', () => {
    // No-id × has-id mixed case: the inline path is keyed by id, the
    // synthesized path is keyed by (file, body). Their key spaces don't
    // overlap, so they can't collide.
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: 'src/auth.ts', line: 10, body: 'Missing semicolon', rootCommentId: 400 }),
      makeFinding({ file: '(review body)', body: 'Missing semicolon' }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  // ─── Trivial pass-through cases ─────────────────────

  it('preserves all findings when every rootCommentId is distinct', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: 'src/auth.ts', line: 10, rootCommentId: 1 }),
      makeFinding({ file: 'src/utils.ts', line: 50, rootCommentId: 2 }),
      makeFinding({ file: 'src/config.ts', line: 5, rootCommentId: 3 }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(3);
  });

  it('does not merge findings in different files (sanity check)', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: 'src/auth.ts', line: 10, body: 'identical', rootCommentId: 10 }),
      makeFinding({ file: 'src/db.ts', line: 10, body: 'identical', rootCommentId: 11 }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  // ─── Output schema invariants ───────────────────────

  it('leaves mergedWith undefined under strict-by-id semantics', () => {
    // mergedWith was the fuzzy-merge audit field. Under strict-by-id
    // it never gets populated; the field stays on the schema for
    // backward-compat with downstream display consumers (per design
    // doc Q1).
    const findings: NormalizedBotFinding[] = [
      makeFinding({ rootCommentId: 50 }),
      makeFinding({ rootCommentId: 51 }),
    ];
    const result = deduplicateFindings(findings);
    for (const r of result) {
      expect(r.mergedWith).toBeUndefined();
    }
  });

  it('prefixes dedupKey with `id:` for inline findings and `body:` for fallback findings', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ file: 'src/auth.ts', body: 'inline', rootCommentId: 700 }),
      makeFinding({ file: '(review body)', body: 'synthesized' }),
    ];
    const result = deduplicateFindings(findings);
    expect(result[0]!.dedupKey).toBe('id:700');
    expect(result[1]!.dedupKey.startsWith('body:')).toBe(true);
    expect(result[1]!.dedupKey).toContain('synthesized');
  });

  it('preserves input order (first-seen wins on collision)', () => {
    const findings: NormalizedBotFinding[] = [
      makeFinding({ tool: 'coderabbit', body: 'first', rootCommentId: 1 }),
      makeFinding({ tool: 'gca', body: 'second', rootCommentId: 2 }),
      makeFinding({ tool: 'coderabbit', body: 'third', rootCommentId: 3 }),
    ];
    const result = deduplicateFindings(findings);
    expect(result.map((r) => r.body)).toEqual(['first', 'second', 'third']);
  });

  it('attaches triageCategory on every output finding', () => {
    const findings: NormalizedBotFinding[] = [makeFinding({ rootCommentId: 1 })];
    const result = deduplicateFindings(findings);
    expect(result[0]!.triageCategory).toBeDefined();
  });
});
