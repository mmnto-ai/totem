import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @clack/prompts confirm to a no-op returning false.
vi.mock('@clack/prompts', () => ({
  confirm: vi.fn().mockResolvedValue(false),
  isCancel: vi.fn().mockReturnValue(false),
}));

// Mock the GitHubCliPrAdapter and gh-utils used by recurrence-stats.
const mockFetchPr = vi.fn();
const mockFetchReviewComments = vi.fn();
const mockGhFetchAndParse = vi.fn();

vi.mock('../adapters/github-cli-pr.js', () => ({
  // Use a real class so `new GitHubCliPrAdapter(...)` is a valid construct.
  GitHubCliPrAdapter: class GitHubCliPrAdapter {
    fetchPr(num: number) {
      return mockFetchPr(num);
    }
    fetchReviewComments(num: number) {
      return mockFetchReviewComments(num);
    }
  },
}));

vi.mock('../adapters/gh-utils.js', () => ({
  ghFetchAndParse: (...args: unknown[]) => mockGhFetchAndParse(...args),
  handleGhError: (err: unknown) => {
    throw err;
  },
}));

// Mock loadConfig + resolveConfigPath to a tmp totemDir.
let tmpDir: string;
let totemDir: string;

vi.mock('../utils.js', () => ({
  loadConfig: vi.fn().mockImplementation(async () => ({ totemDir: '.totem' })),
  resolveConfigPath: vi.fn().mockReturnValue(''),
}));

import { runRecurrenceStats } from './recurrence-stats.js';

// ─── Test setup ────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recurrence-stats-'));
  totemDir = path.join(tmpDir, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });

  // Run from tmpDir so totemDir resolves under it.
  process.chdir(tmpDir);

  mockFetchPr.mockReset();
  mockFetchReviewComments.mockReset();
  mockGhFetchAndParse.mockReset();
});

afterEach(() => {
  // Restore cwd to a known location so test cleanup can rm tmpDir.
  process.chdir(os.tmpdir());
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

// ─── Test data factories ───────────────────────────────

function makeReviewComment(overrides: {
  id: number;
  prAuthor?: string;
  filePath?: string;
  line?: number;
  body: string;
}) {
  return {
    id: overrides.id,
    author: overrides.prAuthor ?? 'coderabbitai[bot]',
    body: overrides.body,
    path: overrides.filePath ?? 'src/handler.ts',
    diffHunk: `@@ -1,3 +${overrides.line ?? 42},3 @@`,
    inReplyToId: undefined,
    createdAt: '2026-04-01T00:00:00.000Z',
  };
}

interface PatternShape {
  signature: string;
  tool: string;
  occurrences: number;
  prs: string[];
  paths: string[];
  coveredByRule: boolean;
}

function loadStats(): {
  version: 1;
  thresholdApplied: number;
  patterns: PatternShape[];
  coveredPatterns: PatternShape[];
  prsScanned: string[];
} {
  const raw = fs.readFileSync(path.join(totemDir, 'recurrence-stats.json'), 'utf-8');
  return JSON.parse(raw);
}

// ─── Tests ─────────────────────────────────────────────

describe('runRecurrenceStats', () => {
  it('collapses path/line variants of the same finding to one signature', async () => {
    mockGhFetchAndParse.mockReturnValue([
      { number: 100, mergedAt: '2026-04-01T00:00:00.000Z' },
      { number: 101, mergedAt: '2026-04-02T00:00:00.000Z' },
      { number: 102, mergedAt: '2026-04-03T00:00:00.000Z' },
    ]);

    // Same finding text, different files / lines / fenced code blocks
    mockFetchPr.mockImplementation((num: number) => ({
      number: num,
      title: `PR ${num}`,
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    }));
    mockFetchReviewComments.mockImplementation((num: number) => {
      const variants = [
        'Avoid using `any` in packages/cli/src/foo.ts:42 — prefer `unknown`.',
        'Avoid using `any` in packages/core/src/bar.ts:99 — prefer `unknown`.',
        'Avoid using `any` in src/baz.ts:7 — prefer `unknown`.',
      ];
      const idx = num - 100;
      return [makeReviewComment({ id: 1000 + num, body: variants[idx]!, line: 42 + idx })];
    });

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    // Threshold 1 → all clusters surface; should be exactly one cluster
    const allPatterns = [...stats.patterns, ...stats.coveredPatterns];
    expect(allPatterns.length).toBe(1);
    expect(allPatterns[0]!.occurrences).toBe(3);
  });

  it('marks cluster as `mixed` when same signature spans multiple bots', async () => {
    mockGhFetchAndParse.mockReturnValue([{ number: 200, mergedAt: '2026-04-01T00:00:00.000Z' }]);
    mockFetchPr.mockReturnValue({
      number: 200,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([
      makeReviewComment({
        id: 1,
        prAuthor: 'coderabbitai[bot]',
        body: 'Avoid using `any` — prefer `unknown`.',
      }),
      makeReviewComment({
        id: 2,
        prAuthor: 'gemini-code-assist[bot]',
        body: 'Avoid using `any` — prefer `unknown`.',
      }),
    ]);

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    const allPatterns = [...stats.patterns, ...stats.coveredPatterns];
    expect(allPatterns.length).toBe(1);
    expect(allPatterns[0]!.tool).toBe('mixed');
    // Two distinct findings with same signature
    expect(allPatterns[0]!.occurrences).toBe(2);
  });

  it('counts occurrences across distinct findings, not distinct PRs', async () => {
    mockGhFetchAndParse.mockReturnValue([
      { number: 300, mergedAt: '2026-04-01T00:00:00.000Z' },
      { number: 301, mergedAt: '2026-04-02T00:00:00.000Z' },
    ]);
    mockFetchPr.mockReturnValue({
      number: 0,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    // PR 300 has 3 distinct findings with the same body, PR 301 has 1.
    // Total occurrences: 4. Distinct PRs: 2.
    mockFetchReviewComments.mockImplementation((num: number) => {
      if (num === 300) {
        return [
          makeReviewComment({ id: 1, body: 'Empty catch block.', filePath: 'a.ts', line: 1 }),
          makeReviewComment({ id: 2, body: 'Empty catch block.', filePath: 'b.ts', line: 2 }),
          makeReviewComment({ id: 3, body: 'Empty catch block.', filePath: 'c.ts', line: 3 }),
        ];
      }
      return [makeReviewComment({ id: 4, body: 'Empty catch block.', filePath: 'd.ts', line: 4 })];
    });

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    const allPatterns = [...stats.patterns, ...stats.coveredPatterns];
    expect(allPatterns.length).toBe(1);
    expect(allPatterns[0]!.occurrences).toBe(4);
    expect(allPatterns[0]!.prs).toEqual(['300', '301']);
  });

  it('dedupes + sorts prs ascending numerically', async () => {
    mockGhFetchAndParse.mockReturnValue([
      { number: 1500, mergedAt: '2026-04-03T00:00:00.000Z' },
      { number: 200, mergedAt: '2026-04-02T00:00:00.000Z' },
      { number: 80, mergedAt: '2026-04-01T00:00:00.000Z' },
    ]);
    mockFetchPr.mockReturnValue({
      number: 0,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockImplementation((num: number) => [
      makeReviewComment({ id: num, body: 'Same finding text everywhere.', filePath: 'x.ts' }),
    ]);

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    const allPatterns = [...stats.patterns, ...stats.coveredPatterns];
    expect(allPatterns.length).toBe(1);
    // 80 < 200 < 1500 numerically (NOT lexically — '1500' < '200' < '80' lex)
    expect(allPatterns[0]!.prs).toEqual(['80', '200', '1500']);
  });

  it('excludes patterns below threshold from headline patterns', async () => {
    mockGhFetchAndParse.mockReturnValue([
      { number: 400, mergedAt: '2026-04-01T00:00:00.000Z' },
      { number: 401, mergedAt: '2026-04-02T00:00:00.000Z' },
    ]);
    mockFetchPr.mockReturnValue({
      number: 0,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockImplementation((num: number) => [
      makeReviewComment({ id: num, body: `Distinct issue ${num}.`, filePath: 'x.ts' }),
    ]);

    // threshold=5 — neither cluster has enough occurrences (each is 1)
    await runRecurrenceStats({ threshold: 5, historyDepth: 5, yes: true });
    const stats = loadStats();
    expect(stats.patterns.length).toBe(0);
  });

  it('routes patterns matching an existing rule to coveredPatterns', async () => {
    // Seed compiled-rules.json with a rule whose message overlaps the
    // finding text well enough to clear Jaccard >= 0.6.
    const rule = {
      lessonHash: 'abc123',
      lessonHeading: 'Avoid any',
      message: 'Avoid using any type — prefer unknown',
      pattern: 'any',
      engine: 'regex' as const,
      severity: 'warning' as const,
      category: 'style' as const,
      fileGlobs: ['**/*.ts'],
      status: 'active' as const,
      compiledAt: '2026-04-01T00:00:00.000Z',
    };
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [rule], nonCompilable: [] }),
    );

    mockGhFetchAndParse.mockReturnValue([{ number: 500, mergedAt: '2026-04-01T00:00:00.000Z' }]);
    mockFetchPr.mockReturnValue({
      number: 500,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([
      makeReviewComment({
        id: 5001,
        body: 'Avoid using any type — prefer unknown.',
      }),
    ]);

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    expect(stats.patterns.length).toBe(0);
    expect(stats.coveredPatterns.length).toBe(1);
    expect(stats.coveredPatterns[0]!.tool).toBe('coderabbit');
  });

  it('atomic write — temp file is cleaned up after rename', async () => {
    mockGhFetchAndParse.mockReturnValue([{ number: 600, mergedAt: '2026-04-01T00:00:00.000Z' }]);
    mockFetchPr.mockReturnValue({
      number: 600,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([makeReviewComment({ id: 6001, body: 'A finding.' })]);

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    expect(fs.existsSync(path.join(totemDir, 'recurrence-stats.json'))).toBe(true);
    // No .tmp residue under any name (covers the legacy fixed-name path
    // AND the unique PID+timestamp form introduced for mmnto-ai/totem#1729 CR R1).
    const residue = fs.readdirSync(totemDir).filter((f) => f.endsWith('.tmp'));
    expect(residue).toEqual([]);
  });

  it('survives concurrent invocations without temp-file collision', async () => {
    mockGhFetchAndParse.mockReturnValue([{ number: 650, mergedAt: '2026-04-01T00:00:00.000Z' }]);
    mockFetchPr.mockReturnValue({
      number: 650,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([
      makeReviewComment({ id: 6501, body: 'Concurrent invocation test finding.' }),
    ]);

    // Two parallel invocations would collide on a fixed `.tmp` path; the
    // PID+epochMs suffix introduced for mmnto-ai/totem#1729 CR R1 keeps
    // them disjoint. Both must resolve and the final file must be valid.
    await Promise.all([
      runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true }),
      runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true }),
    ]);

    expect(fs.existsSync(path.join(totemDir, 'recurrence-stats.json'))).toBe(true);
    const stats = loadStats();
    expect(stats.version).toBe(1);
    // No .tmp residue under any name
    const residue = fs.readdirSync(totemDir).filter((f) => f.endsWith('.tmp'));
    expect(residue).toEqual([]);
  });

  it('does not throw when compiled-rules.json is missing', async () => {
    // Make sure rules file does not exist
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    if (fs.existsSync(rulesPath)) fs.unlinkSync(rulesPath);

    mockGhFetchAndParse.mockReturnValue([{ number: 700, mergedAt: '2026-04-01T00:00:00.000Z' }]);
    mockFetchPr.mockReturnValue({
      number: 700,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([
      makeReviewComment({ id: 7001, body: 'Some finding.' }),
    ]);

    await expect(
      runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true }),
    ).resolves.toBeUndefined();
  });

  it('folds trap-ledger override events as co-equal findings', async () => {
    // Seed events.ndjson with one override event
    const ledgerDir = path.join(totemDir, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const event = {
      timestamp: '2026-04-01T00:00:00.000Z',
      type: 'override',
      ruleId: 'rule-xyz',
      file: 'src/legacy.ts',
      line: 10,
      justification: 'Legacy code we will refactor later.',
      source: 'shield',
    };
    fs.writeFileSync(path.join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\n');

    mockGhFetchAndParse.mockReturnValue([]);
    mockFetchPr.mockReturnValue({
      number: 0,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([]);

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    const allPatterns = [...stats.patterns, ...stats.coveredPatterns];
    expect(allPatterns.length).toBe(1);
    expect(allPatterns[0]!.tool).toBe('override');
    // Override events are not tied to a PR
    expect(allPatterns[0]!.prs).toEqual([]);
  });

  it('marks cluster as `mixed` when override + bot finding share a signature', async () => {
    const ledgerDir = path.join(totemDir, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    // Use a justification that, after normalization, matches the bot finding
    const event = {
      timestamp: '2026-04-01T00:00:00.000Z',
      type: 'override',
      ruleId: 'rule-xyz',
      file: 'src/handler.ts',
      line: 10,
      justification: 'Avoid using any type prefer unknown.',
      source: 'shield',
    };
    fs.writeFileSync(path.join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\n');

    mockGhFetchAndParse.mockReturnValue([{ number: 800, mergedAt: '2026-04-01T00:00:00.000Z' }]);
    mockFetchPr.mockReturnValue({
      number: 800,
      title: 't',
      body: '',
      state: 'merged',
      comments: [],
      reviews: [],
    });
    mockFetchReviewComments.mockReturnValue([
      makeReviewComment({ id: 8001, body: 'Avoid using any type prefer unknown.' }),
    ]);

    await runRecurrenceStats({ threshold: 1, historyDepth: 5, yes: true });

    const stats = loadStats();
    const allPatterns = [...stats.patterns, ...stats.coveredPatterns];
    expect(allPatterns.length).toBe(1);
    expect(allPatterns[0]!.tool).toBe('mixed');
    expect(allPatterns[0]!.occurrences).toBe(2);
    expect(allPatterns[0]!.prs).toEqual(['800']);
  });
});
