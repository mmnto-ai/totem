import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Mocks ──────────────────────────────────────────────
//
// `retrospect.ts` lazy-imports the adapter, ui, parsers, and core. vi.mock
// is hoisted, so these stubs land in place before the dynamic imports
// inside runRetrospect resolve.

const mockFetchPr = vi.fn();
const mockFetchReviews = vi.fn();
const mockFetchReviewComments = vi.fn();

vi.mock('../adapters/github-cli-pr.js', () => ({
  GitHubCliPrAdapter: class GitHubCliPrAdapter {
    fetchPr(num: number) {
      return mockFetchPr(num);
    }
    fetchReviews(num: number) {
      return mockFetchReviews(num);
    }
    fetchReviewComments(num: number) {
      return mockFetchReviewComments(num);
    }
  },
}));

// Capture every log line so tests can assert on tag invariants.
vi.mock('../ui.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
  },
}));

// Mock loadConfig + resolveConfigPath to a tmp totemDir.
vi.mock('../utils.js', () => ({
  loadConfig: vi.fn().mockImplementation(async () => ({ totemDir: '.totem' })),
  resolveConfigPath: vi.fn().mockReturnValue(''),
}));

const uiModule = await import('../ui.js');
const mockLog = vi.mocked(uiModule.log);

// ─── Test data factories ───────────────────────────────

function makeReview(overrides: {
  id: number;
  user_login?: string | null;
  commit_id?: string | null;
  submitted_at?: string;
  state?: string;
  body?: string;
}) {
  return {
    id: overrides.id,
    user_login: overrides.user_login === undefined ? 'coderabbitai[bot]' : overrides.user_login,
    commit_id: overrides.commit_id ?? 'sha-default',
    submitted_at: overrides.submitted_at ?? '2026-04-29T01:00:00.000Z',
    state: overrides.state ?? 'COMMENTED',
    body: overrides.body ?? '',
  };
}

function makeInlineComment(overrides: {
  id: number;
  author?: string;
  body?: string;
  filePath?: string;
  line?: number;
  createdAt?: string;
}) {
  return {
    id: overrides.id,
    author: overrides.author ?? 'coderabbitai[bot]',
    body: overrides.body ?? 'Avoid using `any` — prefer `unknown`.',
    path: overrides.filePath ?? 'src/handler.ts',
    diffHunk: `@@ -1,3 +${overrides.line ?? 42},3 @@`,
    inReplyToId: undefined,
    createdAt: overrides.createdAt ?? '2026-04-29T01:00:30.000Z',
  };
}

function makePr(overrides: { number: number; state?: string }) {
  return {
    number: overrides.number,
    title: `PR #${overrides.number}`,
    body: '',
    state: overrides.state ?? 'open',
    comments: [],
    reviews: [],
  };
}

// ─── Test setup ────────────────────────────────────────

let tmpDir: string;
let totemDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrospect-'));
  totemDir = path.join(tmpDir, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(tmpDir);

  mockFetchPr.mockReset();
  mockFetchReviews.mockReset();
  mockFetchReviewComments.mockReset();
  for (const fn of Object.values(mockLog)) {
    (fn as ReturnType<typeof vi.fn>).mockReset();
  }
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

// ─── Tests ──────────────────────────────────────────────

describe('runRetrospect — sub-threshold skip', () => {
  it('exits 0 (resolves) when rounds < threshold and --force is not set', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 1713 }));
    mockFetchReviews.mockReturnValue([
      makeReview({
        id: 1,
        commit_id: 'sha-A',
        submitted_at: '2026-04-29T01:00:00.000Z',
      }),
    ]);
    mockFetchReviewComments.mockReturnValue([]);

    const { runRetrospect } = await import('./retrospect.js');
    await expect(runRetrospect({ prNumber: '1713', threshold: 5 })).resolves.toBeUndefined();

    // Skip message logged.
    const skipCall = mockLog.info.mock.calls.find((c) => String(c[1]).includes('below threshold'));
    expect(skipCall).toBeDefined();
  });

  it('renders the report when --force is passed below threshold', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 1713 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({ id: 100, createdAt: '2026-04-29T01:00:30.000Z' }),
    ]);

    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '1713', threshold: 5, force: true });

    // Should NOT log the skip message.
    const skipCall = mockLog.info.mock.calls.find((c) => String(c[1]).includes('below threshold'));
    expect(skipCall).toBeUndefined();
    // Should log the headline summary.
    const headline = mockLog.info.mock.calls.find((c) => String(c[1]).includes('PR #1713'));
    expect(headline).toBeDefined();
  });
});

describe('runRetrospect — substrate graceful degrade', () => {
  it('exits 0 with substrateAvailable: false when recurrence-stats.json is absent', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 200 }));
    // 5 rounds via 5 distinct head SHAs so threshold is met.
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
      makeReview({ id: 2, commit_id: 'sha-B', submitted_at: '2026-04-29T02:00:00.000Z' }),
      makeReview({ id: 3, commit_id: 'sha-C', submitted_at: '2026-04-29T03:00:00.000Z' }),
      makeReview({ id: 4, commit_id: 'sha-D', submitted_at: '2026-04-29T04:00:00.000Z' }),
      makeReview({ id: 5, commit_id: 'sha-E', submitted_at: '2026-04-29T05:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({ id: 100, createdAt: '2026-04-29T01:30:00.000Z' }),
    ]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '200', threshold: 5, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.substrateAvailable).toBe(false);
    // Every finding has crossPrRecurrence: 0.
    const all = [...written.routeOutCandidates, ...written.inPrFixes, ...written.undetermined];
    for (const f of all) expect(f.crossPrRecurrence).toBe(0);

    // Warning emitted naming the missing file.
    const warnCall = mockLog.warn.mock.calls.find((c) =>
      String(c[1]).includes('recurrence-stats.json'),
    );
    expect(warnCall).toBeDefined();
  });

  it('treats malformed recurrence-stats.json as missing and continues', async () => {
    fs.writeFileSync(path.join(totemDir, 'recurrence-stats.json'), 'this is not json', 'utf-8');
    mockFetchPr.mockReturnValue(makePr({ number: 201 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
      makeReview({ id: 2, commit_id: 'sha-B', submitted_at: '2026-04-29T02:00:00.000Z' }),
      makeReview({ id: 3, commit_id: 'sha-C', submitted_at: '2026-04-29T03:00:00.000Z' }),
      makeReview({ id: 4, commit_id: 'sha-D', submitted_at: '2026-04-29T04:00:00.000Z' }),
      makeReview({ id: 5, commit_id: 'sha-E', submitted_at: '2026-04-29T05:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({ id: 100, createdAt: '2026-04-29T01:30:00.000Z' }),
    ]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '201', threshold: 5, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.substrateAvailable).toBe(false);
    const warnCall = mockLog.warn.mock.calls.find((c) => String(c[1]).includes('Could not parse'));
    expect(warnCall).toBeDefined();
  });

  it('honors compiled-rules absence with compiledRulesAvailable: false', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 202 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({ id: 100, createdAt: '2026-04-29T01:30:00.000Z' }),
    ]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '202', threshold: 1, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.compiledRulesAvailable).toBe(false);
    const all = [...written.routeOutCandidates, ...written.inPrFixes, ...written.undetermined];
    for (const f of all) expect(f.coveredByRule).toBe(false);
  });
});

describe('runRetrospect — round grouping invariants', () => {
  it('collapses two reviews on the same head_sha into one round', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 300 }));
    mockFetchReviews.mockReturnValue([
      makeReview({
        id: 1,
        commit_id: 'sha-A',
        submitted_at: '2026-04-29T01:00:00.000Z',
        user_login: 'coderabbitai[bot]',
      }),
      makeReview({
        id: 2,
        commit_id: 'sha-A',
        submitted_at: '2026-04-29T01:30:00.000Z',
        user_login: 'gemini-code-assist[bot]',
      }),
    ]);
    mockFetchReviewComments.mockReturnValue([]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '300', threshold: 1, force: true, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.rounds).toHaveLength(1);
    expect(written.rounds[0].headSha).toBe('sha-A');
  });

  it('separates reviews on different head_sha into distinct rounds', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 301 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
      makeReview({ id: 2, commit_id: 'sha-B', submitted_at: '2026-04-29T02:00:00.000Z' }),
      makeReview({ id: 3, commit_id: 'sha-C', submitted_at: '2026-04-29T03:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '301', threshold: 1, force: true, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.rounds).toHaveLength(3);
    expect(written.rounds.map((r: { headSha: string }) => r.headSha)).toEqual([
      'sha-A',
      'sha-B',
      'sha-C',
    ]);
  });
});

describe('runRetrospect — cross-PR recurrence excludes target PR', () => {
  it('counts only OTHER PRs in crossPrRecurrence even if target has same signature N times', async () => {
    // Build a recurrence-stats.json substrate where a finding from PR
    // 400 (the target) appears 5x — should yield crossPrRecurrence: 0
    // (not 5) because the target PR is excluded from the count.
    const targetPr = '400';

    // Compute the signature using core's helpers so the substrate matches.
    const { signatureOfBody } = await import('@mmnto/totem');
    const findingBody = 'Avoid using `any` — prefer `unknown`.';
    const sig = signatureOfBody(findingBody);

    fs.writeFileSync(
      path.join(totemDir, 'recurrence-stats.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-04-29T00:00:00.000Z',
        thresholdApplied: 1,
        historyDepth: 50,
        prsScanned: [targetPr],
        patterns: [
          {
            signature: sig,
            tool: 'coderabbit',
            severityBucket: 'medium',
            occurrences: 5,
            // All 5 occurrences are on the target PR.
            prs: [targetPr, targetPr, targetPr, targetPr, targetPr],
            sampleBodies: [findingBody],
            firstSeen: 'x',
            lastSeen: 'y',
            paths: [],
            coveredByRule: false,
          },
        ],
        coveredPatterns: [],
      }),
      'utf-8',
    );

    mockFetchPr.mockReturnValue(makePr({ number: 400 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({ id: 100, body: findingBody, createdAt: '2026-04-29T01:30:00.000Z' }),
    ]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: targetPr, threshold: 1, force: true, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.substrateAvailable).toBe(true);
    const all = [...written.routeOutCandidates, ...written.inPrFixes, ...written.undetermined];
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect(f.crossPrRecurrence).toBe(0);
  });

  it('counts OTHER PRs only when they actually exist on the substrate', async () => {
    const { signatureOfBody } = await import('@mmnto/totem');
    const findingBody = 'Empty catch block — prefer logging the error.';
    const sig = signatureOfBody(findingBody);

    fs.writeFileSync(
      path.join(totemDir, 'recurrence-stats.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-04-29T00:00:00.000Z',
        thresholdApplied: 1,
        historyDepth: 50,
        prsScanned: ['401', '402', '403'],
        patterns: [
          {
            signature: sig,
            tool: 'coderabbit',
            severityBucket: 'medium',
            occurrences: 4,
            // PR 401 is the target; 402, 403 are siblings.
            prs: ['401', '402', '403'],
            sampleBodies: [findingBody],
            firstSeen: 'x',
            lastSeen: 'y',
            paths: [],
            coveredByRule: false,
          },
        ],
        coveredPatterns: [],
      }),
      'utf-8',
    );

    mockFetchPr.mockReturnValue(makePr({ number: 401 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({ id: 100, body: findingBody, createdAt: '2026-04-29T01:30:00.000Z' }),
    ]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '401', threshold: 1, force: true, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    const all = [...written.routeOutCandidates, ...written.inPrFixes, ...written.undetermined];
    // Find the matched finding by signature.
    const matched = all.find((f: { signature: string }) => f.signature === sig);
    expect(matched).toBeDefined();
    expect(matched.crossPrRecurrence).toBe(2); // 402 and 403, NOT 401
  });
});

describe('runRetrospect — zero-bot edge case', () => {
  it('emits an empty-finding report when the PR has no bot comments', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 500 }));
    mockFetchReviews.mockReturnValue([]);
    mockFetchReviewComments.mockReturnValue([]);

    const outPath = path.join(tmpDir, 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '500', threshold: 1, force: true, out: outPath });

    const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    expect(written.totalFindings).toBe(0);
    expect(written.rounds).toHaveLength(0);
    expect(written.routeOutCandidates).toEqual([]);
    expect(written.inPrFixes).toEqual([]);
    expect(written.undetermined).toEqual([]);
  });
});

describe('runRetrospect — --out write semantics', () => {
  it('writes a deterministic two-space-indented JSON file when --out is set', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 600 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([]);

    const outPath = path.join(tmpDir, 'sub', 'report.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '600', threshold: 1, force: true, out: outPath });

    expect(fs.existsSync(outPath)).toBe(true);
    const raw = fs.readFileSync(outPath, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    // Two-space indent = `  "version"`.
    expect(raw).toMatch(/\n {2}"version": 1/);
  });

  it('does NOT create any file under .totem/ by default (no --out)', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 601 }));
    mockFetchReviews.mockReturnValue([
      makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
    ]);
    mockFetchReviewComments.mockReturnValue([]);

    // Snapshot mtimes of every file currently under .totem/.
    const before = fs.readdirSync(totemDir).map((name) => {
      const p = path.join(totemDir, name);
      return { name, mtimeMs: fs.statSync(p).mtimeMs };
    });

    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '601', threshold: 1, force: true });

    const after = fs.readdirSync(totemDir).map((name) => {
      const p = path.join(totemDir, name);
      return { name, mtimeMs: fs.statSync(p).mtimeMs };
    });

    // Same set of files, same mtimes — no writes.
    expect(after).toEqual(before);
  });
});

describe('runRetrospect — no-LLM invariant', () => {
  // ─── Static-source guard ─────────────────────────────
  // Mirrors the shield-estimate.ts no-LLM guard. A static-source grep
  // catches a future drift where someone adds an orchestrator import.

  it('never imports the orchestrator or LLM-path modules from retrospect.ts', async () => {
    const cmdPath = path.join(__dirname, 'retrospect.ts');
    const source = fs.readFileSync(cmdPath, 'utf-8');
    expect(source).not.toMatch(/from ['"]\.\.\/orchestrators\//);
    expect(source).not.toMatch(/from ['"]@mmnto\/totem-orchestrator['"]/);
    expect(source).not.toMatch(/getOrchestrator/);
    expect(source).not.toMatch(/createOrchestrator/);
    expect(source).not.toMatch(/runOrchestrator/);
    expect(source).not.toMatch(/Anthropic/);
    expect(source).not.toMatch(/OpenAI/);
    expect(source).not.toMatch(/\bgemini\b/i);
    expect(source).not.toMatch(/createEmbedder/);
    expect(source).not.toMatch(/LanceStore/);
  });

  it('never imports the orchestrator or LLM-path modules from core/retrospect.ts', async () => {
    const corePath = path.join(__dirname, '..', '..', '..', 'core', 'src', 'retrospect.ts');
    const source = fs.readFileSync(corePath, 'utf-8');
    expect(source).not.toMatch(/from ['"]@mmnto\/totem-orchestrator['"]/);
    expect(source).not.toMatch(/getOrchestrator/);
    expect(source).not.toMatch(/createOrchestrator/);
    expect(source).not.toMatch(/runOrchestrator/);
    expect(source).not.toMatch(/Anthropic/);
    expect(source).not.toMatch(/OpenAI/);
    expect(source).not.toMatch(/\bgemini\b/i);
    expect(source).not.toMatch(/createEmbedder/);
    expect(source).not.toMatch(/LanceStore/);
  });

  // ─── Runtime guard ────────────────────────────────────
  // Even if some import sneaks in, the orchestrator factory must not be
  // called during a retrospect run. We inspect the on-disk source again
  // because mocking the orchestrator factory at runtime would be a
  // tautology — the import is statically banned by the guard above.

  it('keeps every runtime call sourced from non-LLM modules', async () => {
    const cmdSource = fs.readFileSync(path.join(__dirname, 'retrospect.ts'), 'utf-8');
    // Confirm every dynamic import in the command resolves to a known
    // non-LLM module. The list mirrors the static-import section near
    // the top of runRetrospect.
    const allowedDynamicImports = [
      "await import('node:fs')",
      "await import('node:path')",
      "await import('zod')",
      "await import('../adapters/github-cli-pr.js')",
      "await import('../ui.js')",
      "await import('../parsers/bot-review-parser.js')",
      "await import('@mmnto/totem')",
      "await import('../utils.js')",
    ];
    // Each one should be present at least once.
    for (const expected of allowedDynamicImports) {
      expect(cmdSource).toContain(expected);
    }
    // No stray `await import('...orchestrator...')` lines.
    expect(cmdSource).not.toMatch(/await import\(['"][^'"]*orchestrator[^'"]*['"]\)/);
  });
});

describe('runRetrospect — classification fan-out', () => {
  // High-level shape check: feed a synthetic finding for each severity
  // bucket and assert that the classification verdicts land in the
  // expected report buckets. Detailed table coverage lives in the
  // core-package retrospect.test.ts; this is the integration shape.

  it.each([
    // CodeRabbit: critical → in-pr-fix
    [
      'crit',
      '🔴 Critical: Avoid using `any` — prefer `unknown`.',
      'critical',
      'inPrFixes',
    ] as const,
    // CodeRabbit: major → high → in-pr-fix
    ['major', '🟠 Major: bigger problem.', 'high', 'inPrFixes'] as const,
    // CodeRabbit: minor → medium → in-pr-fix at early round
    ['minor', '🟡 Minor: small thing.', 'medium', 'inPrFixes'] as const,
  ])(
    'classifies a CR %s finding into bucket %s with severity %s',
    async (_label, body, expectedSeverity, expectedBucket) => {
      mockFetchPr.mockReturnValue(makePr({ number: 700 }));
      mockFetchReviews.mockReturnValue([
        makeReview({ id: 1, commit_id: 'sha-A', submitted_at: '2026-04-29T01:00:00.000Z' }),
      ]);
      mockFetchReviewComments.mockReturnValue([
        makeInlineComment({
          id: 100,
          body,
          createdAt: '2026-04-29T01:30:00.000Z',
        }),
      ]);

      const outPath = path.join(tmpDir, 'report.json');
      const { runRetrospect } = await import('./retrospect.js');
      await runRetrospect({ prNumber: '700', threshold: 1, force: true, out: outPath });

      const written = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      const target = written[expectedBucket];
      expect(target.length).toBeGreaterThan(0);
      expect(target[0].severityBucket).toBe(expectedSeverity);
    },
  );
});

describe('runRetrospect — input validation (mmnto-ai/totem#1734 review-1)', () => {
  it('rejects PR number with trailing non-numerics (Number.isInteger guard)', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 1713 }));
    mockFetchReviews.mockReturnValue([]);
    mockFetchReviewComments.mockReturnValue([]);

    const { runRetrospect } = await import('./retrospect.js');
    await expect(runRetrospect({ prNumber: '1713foo', force: true })).rejects.toThrow(
      /Invalid PR number/,
    );
  });

  it('rejects fractional PR number (e.g. "5.2")', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 1713 }));
    mockFetchReviews.mockReturnValue([]);
    mockFetchReviewComments.mockReturnValue([]);

    const { runRetrospect } = await import('./retrospect.js');
    await expect(runRetrospect({ prNumber: '5.2', force: true })).rejects.toThrow(
      /Invalid PR number/,
    );
  });

  it('rejects non-positive PR number', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 1713 }));
    mockFetchReviews.mockReturnValue([]);
    mockFetchReviewComments.mockReturnValue([]);

    const { runRetrospect } = await import('./retrospect.js');
    await expect(runRetrospect({ prNumber: '0', force: true })).rejects.toThrow(
      /Invalid PR number/,
    );
  });
});

describe('runRetrospect — null user_login (deleted/ghost accounts)', () => {
  it('skips review submissions whose user_login is null without inflating round count', async () => {
    mockFetchPr.mockReturnValue(makePr({ number: 1713 }));
    mockFetchReviews.mockReturnValue([
      makeReview({
        id: 1,
        commit_id: 'sha-A',
        submitted_at: '2026-04-29T01:00:00.000Z',
        user_login: 'coderabbitai[bot]',
      }),
      // GitHub API returns null user for deleted/ghost accounts.
      makeReview({
        id: 2,
        commit_id: 'sha-B',
        submitted_at: '2026-04-29T01:30:00.000Z',
        user_login: null,
      }),
    ]);
    mockFetchReviewComments.mockReturnValue([
      makeInlineComment({
        id: 100,
        author: 'coderabbitai[bot]',
        createdAt: '2026-04-29T01:05:00.000Z',
      }),
      makeInlineComment({
        id: 101,
        // Inline comment from a deleted account — author would be 'ghost' or empty
        // in practice; here we model it via the parser path via isBotComment('').
        author: 'ghost',
        createdAt: '2026-04-29T01:35:00.000Z',
      }),
    ]);

    const outPath = path.join(tmpDir, 'out.json');
    const { runRetrospect } = await import('./retrospect.js');
    await runRetrospect({ prNumber: '1713', force: true, out: outPath });

    const report = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
    // Only the bot-authored finding survives; the ghost-authored one drops.
    expect(report.totalFindings).toBe(1);
    // Round count reflects only bot rounds (sha-A); sha-B is skipped because
    // its review submission's user_login is null.
    expect(report.rounds.length).toBe(1);
    expect(report.rounds[0].headSha).toBe('sha-A');
  });
});
