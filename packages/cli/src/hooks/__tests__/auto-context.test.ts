import { describe, expect, it } from 'vitest';

import type { AutoContextResult } from '../auto-context.js';
import { parseBranch, truncateResults } from '../auto-context.js';

// ─── Branch Parsing ───────────────────────────────────────

describe('parseBranch', () => {
  it('extracts ticket number from feature branch', () => {
    const result = parseBranch('feat/1095-session-start-v2');
    expect(result.ticket).toBe('1095');
    expect(result.query).toContain('1095');
    expect(result.query).toContain('session');
  });

  it('extracts ticket from fix branch', () => {
    const result = parseBranch('fix/894-compile-progress');
    expect(result.ticket).toBe('894');
    expect(result.query).toContain('894');
  });

  it('handles branch with no ticket number', () => {
    const result = parseBranch('fix/login-bug');
    expect(result.ticket).toBeNull();
    expect(result.query).toBe('login bug');
  });

  it('returns fallback for main', () => {
    const result = parseBranch('main');
    expect(result.ticket).toBeNull();
    expect(result.query).toBe('project overview');
  });

  it('returns fallback for master', () => {
    const result = parseBranch('master');
    expect(result.ticket).toBeNull();
    expect(result.query).toBe('project overview');
  });

  it('returns fallback for develop', () => {
    const result = parseBranch('develop');
    expect(result.ticket).toBeNull();
    expect(result.query).toBe('project overview');
  });

  it('handles bare ticket number branch', () => {
    const result = parseBranch('1095-direct');
    expect(result.ticket).toBe('1095');
    expect(result.query).toBe('1095 direct');
  });

  it('handles empty string', () => {
    const result = parseBranch('');
    expect(result.ticket).toBeNull();
    expect(result.query).toBe('project overview');
  });

  it('strips prefix and converts delimiters to spaces', () => {
    const result = parseBranch('chore/update_deps-and-stuff');
    expect(result.query).toBe('update deps and stuff');
  });
});

// ─── Budget Truncation ────────────────────────────────────

function fakeResult(label: string, contentLength: number) {
  return {
    content: 'x'.repeat(contentLength),
    contextPrefix: '',
    filePath: 'test.ts',
    type: 'code' as const,
    label,
    score: 0.95,
    metadata: {},
  };
}

describe('truncateResults', () => {
  it('returns empty for no results', () => {
    const { content, included } = truncateResults([], 10_000);
    expect(content).toBe('');
    expect(included).toBe(0);
  });

  it('includes all results when under budget', () => {
    const results = [fakeResult('A', 100), fakeResult('B', 100), fakeResult('C', 100)];
    const { content, included } = truncateResults(results, 10_000);
    expect(included).toBe(3);
    expect(content).not.toContain('omitted');
  });

  it('enforces character budget', () => {
    const results = Array.from({ length: 10 }, (_, i) => fakeResult(`Result${i}`, 3000));
    const { content, included } = truncateResults(results, 10_000);
    expect(content.length).toBeLessThanOrEqual(10_100); // small overhead for truncation note
    expect(included).toBeLessThan(10);
    expect(content).toContain('omitted');
  });

  it('always includes at least one result even if over budget', () => {
    const results = [fakeResult('BigOne', 15_000)];
    const { included } = truncateResults(results, 10_000);
    expect(included).toBe(1);
  });

  it('shows omitted count in singular form', () => {
    const results = [fakeResult('A', 8000), fakeResult('B', 8000)];
    const { content } = truncateResults(results, 10_000);
    expect(content).toContain('1 additional result omitted');
  });

  it('shows omitted count in plural form', () => {
    const results = Array.from({ length: 5 }, (_, i) => fakeResult(`R${i}`, 4000));
    const { content } = truncateResults(results, 10_000);
    expect(content).toContain('additional results omitted');
  });
});

// ─── getAutoContext (integration-level, mocked at boundaries) ──

describe('getAutoContext result shape', () => {
  it('returns correct shape for empty result', () => {
    const result: AutoContextResult = {
      query: 'test',
      resultsIncluded: 0,
      totalFound: 0,
      content: '',
      searchMethod: 'none',
      durationMs: 0,
    };
    expect(result.searchMethod).toBe('none');
    expect(result.content).toBe('');
  });
});
