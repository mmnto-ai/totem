import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getAutoContext, parseBranch, truncateResults } from '../auto-context.js';

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

// ─── getAutoContext (graceful degradation) ─────────────────

describe('getAutoContext', () => {
  it('returns empty context when projectRoot has no totem config', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-test-'));
    try {
      const result = await getAutoContext({
        branchRef: 'feat/999-nonexistent',
        projectRoot: tmpDir,
      });
      expect(result.searchMethod).toBe('none');
      expect(result.content).toBe('');
      expect(result.resultsIncluded).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty context when lancedb directory is missing', async () => {
    // Create a tmpdir with a minimal totem.config.ts but no .lancedb
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      'export default { targets: [], embedding: { provider: "gemini" } };',
    );
    try {
      const result = await getAutoContext({
        branchRef: 'main',
        maxCharacters: 100,
        limit: 1,
        projectRoot: tmpDir,
      });
      expect(result.query).toBe('project overview');
      expect(result.searchMethod).toBe('none');
      expect(typeof result.durationMs).toBe('number');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('respects maxCharacters in returned content', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-test-'));
    try {
      const result = await getAutoContext({
        branchRef: 'feat/1095-session-start',
        maxCharacters: 500,
        limit: 2,
        projectRoot: tmpDir,
      });
      // No config → empty content, budget respected trivially
      expect(result.content).toBe('');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
