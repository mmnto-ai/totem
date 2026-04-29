import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

import type { DiffForReviewSource } from '../git.js';
import { cleanTmpDir } from '../test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Mocks ──────────────────────────────────────────────
//
// `shield-estimate.ts` lazy-imports `../git.js`, `./run-compiled-rules.js`,
// and `../ui.js` per the dynamic-imports-in-CLI policy (CR R1 on
// `mmnto-ai/totem#1729`). vi.mock is hoisted, so these stubs are in place
// before runEstimate's dynamic imports resolve.

vi.mock('../git.js', async () => {
  const actual = await vi.importActual<typeof import('../git.js')>('../git.js');
  return {
    ...actual,
    getDiffForReview: vi.fn(),
  };
});

vi.mock('./run-compiled-rules.js', () => ({
  runCompiledRules: vi.fn(),
}));

vi.mock('../ui.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
  },
}));

// Stub config loading so the second describe block (which exercises
// shieldCommand directly) can run without scaffolding a real
// totem.config.ts on disk. Same shape as `lint.test.ts`.
vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
    loadEnv: () => {},
  };
});

const gitModule = await import('../git.js');
const rcrModule = await import('./run-compiled-rules.js');
const uiModule = await import('../ui.js');
const mockGetDiffForReview = vi.mocked(gitModule.getDiffForReview);
const mockRunCompiledRules = vi.mocked(rcrModule.runCompiledRules);
const mockLog = vi.mocked(uiModule.log);

// ─── Helpers ────────────────────────────────────────────

function makeConfig(): TotemConfig {
  // Minimal TotemConfig surface that runEstimate touches: totemDir +
  // ignorePatterns. The real schema has more fields but they are not
  // read on the estimate path.
  return {
    totemDir: '.totem',
    ignorePatterns: ['package-lock.json', '*.snap'],
  } as unknown as TotemConfig;
}

const SAMPLE_DIFF =
  'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1,2 @@\n existing\n+new line\n';

function diffResult(
  overrides: Partial<{ diff: string; changedFiles: string[]; source: DiffForReviewSource }> = {},
) {
  return {
    diff: SAMPLE_DIFF,
    changedFiles: ['foo.ts'],
    source: 'uncommitted' as DiffForReviewSource,
    ...overrides,
  };
}

function runCompiledRulesPassResult() {
  return {
    violations: [],
    rules: [],
    output: 'PASS',
    findings: [],
    regexTimeouts: [],
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('runEstimate', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-estimate-'));
    originalCwd = process.cwd();
    mockGetDiffForReview.mockReset();
    mockRunCompiledRules.mockReset();
    for (const fn of Object.values(mockLog)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  // ─── Empty-diff branch ────────────────────────────

  it('returns clean and skips runCompiledRules when getDiffForReview returns null', async () => {
    mockGetDiffForReview.mockResolvedValue(null);

    const { runEstimate } = await import('./shield-estimate.js');
    await expect(
      runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir),
    ).resolves.toBeUndefined();

    expect(mockRunCompiledRules).not.toHaveBeenCalled();

    // Empty-diff branch logs the "No changes detected" line under the
    // Estimate tag — never under Review.
    const noChangesCall = mockLog.info.mock.calls.find((c) =>
      String(c[1]).includes('No changes detected. Nothing to estimate.'),
    );
    expect(noChangesCall).toBeDefined();
    expect(noChangesCall![0]).toBe('Estimate');
  });

  // ─── Tag invariant ────────────────────────────────

  it('passes the Estimate tag (never Review) to getDiffForReview and runCompiledRules', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    // getDiffForReview's 4th arg is the tag.
    expect(mockGetDiffForReview).toHaveBeenCalledTimes(1);
    expect(mockGetDiffForReview.mock.calls[0]![3]).toBe('Estimate');

    // runCompiledRules.tag must be Estimate.
    expect(mockRunCompiledRules).toHaveBeenCalledTimes(1);
    const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
    expect(rcrArgs.tag).toBe('Estimate');

    // No log line on the estimate path may use the Review tag.
    for (const call of mockLog.info.mock.calls) {
      expect(call[0]).not.toBe('Review');
    }
  });

  it('emits a [Estimate] preamble before delegating to getDiffForReview', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const preambleCall = mockLog.info.mock.calls.find((c) =>
      String(c[1]).includes('Pre-flight prediction'),
    );
    expect(preambleCall).toBeDefined();
    expect(preambleCall![0]).toBe('Estimate');
  });

  // ─── Diff pass-through ────────────────────────────

  it('forwards the diff returned by getDiffForReview unchanged to runCompiledRules', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
    expect(rcrArgs.diff).toBe(SAMPLE_DIFF);
  });

  it('forwards ignorePatterns from config into runCompiledRules', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
    expect(rcrArgs.ignorePatterns).toEqual(['package-lock.json', '*.snap']);
  });

  it('forwards configRoot, totemDir, and isStaged into runCompiledRules', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult({ source: 'staged' }));
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const configRoot = path.join(tmpDir, 'sub-root');

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true, staged: true }, makeConfig(), tmpDir, configRoot);

    const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
    expect(rcrArgs.configRoot).toBe(configRoot);
    expect(rcrArgs.totemDir).toBe('.totem');
    expect(rcrArgs.isStaged).toBe(true);
  });

  // mmnto-ai/totem#1732 CR R2 — `--diff` outranks `--staged` in
  // `getDiffForReview`. `isStaged` must follow the resolved
  // `DiffForReviewSource`, not the raw CLI flag, so the staged-index
  // read strategy only kicks in for genuinely staged runs.
  it('derives isStaged from diffResult.source, not options.staged, when both --diff and --staged are passed', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult({ source: 'explicit-range' }));
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate(
      { estimate: true, staged: true, diff: 'main...HEAD' },
      makeConfig(),
      tmpDir,
      tmpDir,
    );

    const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
    expect(rcrArgs.isStaged).toBe(false);
  });

  it.each([
    ['uncommitted', false] as const,
    ['branch-vs-base', false] as const,
    ['explicit-range', false] as const,
    ['staged', true] as const,
  ])(
    'isStaged is true iff resolved source is "staged" (source=%s → isStaged=%s)',
    async (source, expected) => {
      mockGetDiffForReview.mockResolvedValue(diffResult({ source }));
      mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

      const { runEstimate } = await import('./shield-estimate.js');
      await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

      const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
      expect(rcrArgs.isStaged).toBe(expected);
    },
  );

  it('forwards options.out as outPath into runCompiledRules', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true, out: 'estimate.txt' }, makeConfig(), tmpDir, tmpDir);

    const rcrArgs = mockRunCompiledRules.mock.calls[0]![0];
    expect(rcrArgs.outPath).toBe('estimate.txt');
    // Format is always 'text' on the estimate path — SARIF/JSON are
    // lint's territory and `runReview` already rejects --format.
    expect(rcrArgs.format).toBe('text');
  });

  // ─── Diff-source resolution branches ──────────────

  it.each([
    ['explicit-range', { estimate: true, diff: 'HEAD^..HEAD' }],
    ['staged', { estimate: true, staged: true }],
    ['uncommitted', { estimate: true }],
    ['branch-vs-base', { estimate: true }],
  ] as const)('honors getDiffForReview source resolution for %s', async (source, options) => {
    mockGetDiffForReview.mockResolvedValue(diffResult({ source }));
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate(options, makeConfig(), tmpDir, tmpDir);

    // Whatever source getDiffForReview chose, the diff is the one
    // passed to runCompiledRules.
    expect(mockRunCompiledRules.mock.calls[0]![0].diff).toBe(SAMPLE_DIFF);
    // And the options object is forwarded to getDiffForReview so it
    // can do its own implicit-source label logging.
    expect(mockGetDiffForReview).toHaveBeenCalledWith(
      options,
      expect.any(Object),
      tmpDir,
      'Estimate',
    );
  });

  // ─── Exit code parity with lint ───────────────────

  it('lets SHIELD_FAILED from runCompiledRules propagate (matches lint exit semantics)', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    const { TotemError } = await import('@mmnto/totem');
    mockRunCompiledRules.mockRejectedValue(
      new TotemError('SHIELD_FAILED', 'Violations detected', 'Fix the violations above.'),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await expect(
      runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir),
    ).rejects.toMatchObject({ code: 'SHIELD_FAILED' });
  });

  it('completes without throwing on a clean pass (zero violations)', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await expect(
      runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir),
    ).resolves.toBeUndefined();
  });

  // ─── No-LLM invariant ─────────────────────────────

  it('never imports the orchestrator or embedding modules from shield-estimate.ts', async () => {
    // Static-source check: a regex-grep over the on-disk shield-estimate
    // source asserts no LLM-path import exists. This catches a future
    // drift where someone adds `runOrchestrator` or `requireEmbedding`
    // to the estimator without going through code review. Pairs with
    // the runtime tag-invariant tests above.
    const estimatePath = path.join(__dirname, 'shield-estimate.ts');
    const source = fs.readFileSync(estimatePath, 'utf-8');
    // Forbidden symbols anywhere in the file — including `import`,
    // re-exports, or string references. shield-templates.ts is a pure
    // constants module so importing ESTIMATE_DISPLAY_TAG from it is
    // safe; the ban is on the LLM/embedding/Lance surfaces.
    expect(source).not.toMatch(/runOrchestrator/);
    expect(source).not.toMatch(/requireEmbedding/);
    expect(source).not.toMatch(/LanceStore/);
    expect(source).not.toMatch(/createEmbedder/);
    // ../utils.js exposes both runOrchestrator and orchestrator
    // helpers; importing it would silently widen the surface even if
    // none of those symbols are referenced. Block the import path
    // outright.
    expect(source).not.toMatch(/from ['"]\.\.\/utils\.js['"]/);
  });
});

// ─── Incompatibility table — driven through shieldCommand ─

describe('shieldCommand --estimate incompatibility guard', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-est-incompat-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
    mockGetDiffForReview.mockReset();
    mockRunCompiledRules.mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it.each([
    ['learn', { learn: true }, '--learn'],
    ['autoCapture', { autoCapture: true }, '--auto-capture'],
    ['override', { override: 'this is a long enough reason' }, '--override'],
    ['suppress', { suppress: ['some-label'] }, '--suppress'],
    ['fresh', { fresh: true }, '--fresh'],
    ['mode-standard', { mode: 'standard' as const }, '--mode'],
    ['mode-structural', { mode: 'structural' as const }, '--mode'],
    ['raw', { raw: true }, '--raw'],
  ])(
    'throws CONFIG_INVALID when --estimate is combined with %s',
    async (_name, extra, expectedFlag) => {
      const { shieldCommand } = await import('./shield.js');
      const { TotemConfigError } = await import('@mmnto/totem');

      const promise = shieldCommand({ estimate: true, ...extra });
      await expect(promise).rejects.toBeInstanceOf(TotemConfigError);
      await expect(promise).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
      await expect(promise).rejects.toThrow(
        new RegExp(
          `${expectedFlag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')} is incompatible with --estimate`,
        ),
      );
    },
  );

  it('does NOT trip the --override length check when --estimate is set', async () => {
    // Without --estimate, a 5-char --override would throw "must be at
    // least 10 characters". With --estimate, the incompatibility guard
    // fires first and the error names the actual conflict.
    const { shieldCommand } = await import('./shield.js');
    await expect(shieldCommand({ estimate: true, override: 'short' })).rejects.toThrow(
      /--override is incompatible with --estimate/,
    );
  });

  it('treats an empty --suppress array as compatible (commander accumulator default)', async () => {
    // Commander seeds --suppress with `[]`. An empty array MUST NOT
    // trigger the incompatibility error — only a non-empty array
    // counts as the user actually passing --suppress.
    mockGetDiffForReview.mockResolvedValue(null);
    const { shieldCommand } = await import('./shield.js');
    await expect(shieldCommand({ estimate: true, suppress: [] })).resolves.toBeUndefined();
  });
});

// ─── Pattern-history overlay (mmnto-ai/totem#1731) ────────

// Helpers shared across the overlay tests. The substrate's `tokenizeForJaccard`
// drops stopwords + tokens of length ≤ 2 (see
// `packages/core/src/recurrence-stats.ts:STOPWORDS`), so fixture tokens are
// chosen 4+ chars and outside that stoplist.
function writeSubstrate(
  tmpDir: string,
  payload: unknown,
  totemDirName = '.totem',
  fileName = 'recurrence-stats.json',
): string {
  const totemDir = path.join(tmpDir, totemDirName);
  fs.mkdirSync(totemDir, { recursive: true });
  const filePath = path.join(totemDir, fileName);
  fs.writeFileSync(
    filePath,
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
    'utf-8',
  );
  return filePath;
}

function makeSubstratePayload(
  patterns: Array<{
    signature: string;
    sampleBodies: string[];
    occurrences?: number;
    prs?: string[];
  }>,
): unknown {
  return {
    version: 1,
    lastUpdated: '2026-04-29T00:00:00.000Z',
    thresholdApplied: 5,
    historyDepth: 50,
    prsScanned: ['1700', '1710'],
    patterns: patterns.map((p) => ({
      signature: p.signature,
      tool: 'coderabbit',
      severityBucket: 'medium',
      occurrences: p.occurrences ?? 3,
      prs: p.prs ?? ['1700', '1710'],
      sampleBodies: p.sampleBodies,
      firstSeen: '2026-04-01T00:00:00.000Z',
      lastSeen: '2026-04-28T00:00:00.000Z',
      paths: [],
      coveredByRule: false,
    })),
    coveredPatterns: [],
  };
}

function diffWithAdditions(addedLines: string[]): string {
  const header =
    'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1,2 @@\n existing\n';
  return header + addedLines.map((l) => `+${l}`).join('\n') + '\n';
}

function infoLines(): string[] {
  return mockLog.info.mock.calls.map((c) => String(c[1] ?? ''));
}

function dimLines(): string[] {
  return mockLog.dim.mock.calls.map((c) => String(c[1] ?? ''));
}

function warnLines(): string[] {
  return mockLog.warn.mock.calls.map((c) => String(c[1] ?? ''));
}

describe('runEstimate — pattern-history overlay', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-history-'));
    originalCwd = process.cwd();
    mockGetDiffForReview.mockReset();
    mockRunCompiledRules.mockReset();
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());
    for (const fn of Object.values(mockLog)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  // ─── Default-on / opt-out semantics ─────────────────

  it('skips the overlay entirely when options.history === false (--no-history)', async () => {
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        {
          signature: 'sig-aaaa',
          sampleBodies: ['avoid using async-storage in render-path components'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({
        diff: diffWithAdditions(['avoid async-storage render-path components']),
      }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true, history: false }, makeConfig(), tmpDir, tmpDir);

    const all = [...infoLines(), ...dimLines(), ...warnLines()];
    expect(all.some((l) => /Pattern-history/i.test(l))).toBe(false);
  });

  it('runs the overlay by default when options.history is undefined', async () => {
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        {
          signature: 'sig-bbbb',
          sampleBodies: ['avoid using async-storage in render-path components'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({
        diff: diffWithAdditions(['avoid async-storage render-path components everywhere']),
      }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const all = [...infoLines(), ...dimLines(), ...warnLines()];
    expect(all.some((l) => /Pattern-history/i.test(l))).toBe(true);
  });

  // ─── Substrate-missing / malformed degradation ──────

  it('emits a single dim hint when recurrence-stats.json is missing', async () => {
    mockGetDiffForReview.mockResolvedValue(diffResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const hints = dimLines().filter((l) => /Pattern-history layer skipped/.test(l));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/totem stats --pattern-recurrence/);
    // Warn surface is untouched by the missing-substrate path.
    expect(warnLines()).toHaveLength(0);
  });

  it('emits a single warn line when recurrence-stats.json is malformed JSON', async () => {
    writeSubstrate(tmpDir, '{ "not": valid json'); // garbage
    mockGetDiffForReview.mockResolvedValue(diffResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await expect(
      runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir),
    ).resolves.toBeUndefined();

    const warns = warnLines().filter((l) => /Pattern-history layer skipped/.test(l));
    expect(warns).toHaveLength(1);
  });

  it('emits a single warn line when recurrence-stats.json fails the schema projection', async () => {
    writeSubstrate(tmpDir, { version: 1, patterns: [{ signature: 42 /* not a string */ }] });
    mockGetDiffForReview.mockResolvedValue(diffResult());

    const { runEstimate } = await import('./shield-estimate.js');
    await expect(
      runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir),
    ).resolves.toBeUndefined();

    const warns = warnLines().filter((l) => /Pattern-history layer skipped/.test(l));
    expect(warns).toHaveLength(1);
  });

  // ─── Containment-coefficient asymmetry — the load-bearing test ──

  it('uses asymmetric containment so a small pattern matches a much larger diff', async () => {
    // Pattern has 5 unique significant tokens. Diff contains all 5 PLUS
    // ~500 unrelated tokens. Containment is 5/5 = 1.0; whole-diff
    // Jaccard would be 5 / (5 + 500) ≈ 0.01 — well below 0.4.
    const patternBody = 'foobar quuxify slartib mariocart wibblewobble';
    const filler = Array.from({ length: 500 }, (_, i) => `unrelated${i}token`).join(' ');
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([{ signature: 'sig-asym', sampleBodies: [patternBody] }]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions([`${patternBody} ${filler}`]) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    // The containment line for our match must surface with 1.00.
    expect(lines.some((l) => /sig-asym/.test(l) && /containment: 1\.00/.test(l))).toBe(true);

    // Sanity: the same fixture fed through Jaccard would NOT have rendered
    // a match (Jaccard ≈ 5/505 ≈ 0.0099 < 0.4). We assert the contrapositive
    // by computing Jaccard via the substrate helper and asserting < 0.05.
    const { jaccard, tokenizeForJaccard } = await import('@mmnto/totem');
    const j = jaccard(
      tokenizeForJaccard(patternBody),
      tokenizeForJaccard(`${patternBody} ${filler}`),
    );
    expect(j).toBeLessThan(0.05);
  });

  // ─── Match-rendering details ────────────────────────

  it('renders the section header with blank separator lines and a per-match block', async () => {
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        {
          signature: 'sig-cccc',
          occurrences: 7,
          prs: ['1700', '1710', '1720'],
          sampleBodies: ['avoid using async-storage in render-path components consistently'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({
        diff: diffWithAdditions(['avoid async-storage render-path components consistently']),
      }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    // Section header + summary line both present, both under [Estimate].
    expect(lines).toContain('─── Pattern-history layer ───');
    expect(lines.some((l) => /1 historical pattern\(s\) match this diff \(uncovered/.test(l))).toBe(
      true,
    );
    // Blank-line separators (Q4 spec).
    expect(lines.filter((l) => l === '').length).toBeGreaterThanOrEqual(2);
    // PR list rendered with hash prefixes.
    expect(lines.some((l) => /sig-cccc/.test(l) && /#1700, #1710, #1720/.test(l))).toBe(true);

    // Tag is Estimate on every overlay info line.
    for (const call of mockLog.info.mock.calls) {
      expect(call[0]).toBe('Estimate');
    }
  });

  it('truncates the rendered sample body to 120 chars with internal whitespace collapsed', async () => {
    const longBody =
      '   foobar    multi-line   sample body  '.repeat(20) + 'quuxify slartib trailingstuff';
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([{ signature: 'sig-trunc', sampleBodies: [longBody] }]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({
        diff: diffWithAdditions(['foobar multi-line sample body quuxify slartib trailingstuff']),
      }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const sampleLine = infoLines().find((l) => /^ {4}".*"$/.test(l));
    expect(sampleLine).toBeDefined();
    const inner = sampleLine!.replace(/^ {4}"|"$/g, '');
    // Collapsed internal whitespace — no double spaces.
    expect(inner).not.toMatch(/ {2,}/);
    // 120 chars + ellipsis.
    expect(inner.length).toBeLessThanOrEqual(121); // 120 + the ellipsis
    expect(inner.endsWith('…')).toBe(true);
  });

  it('emits a single dim "0 matches" line when no pattern clears the threshold', async () => {
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        {
          signature: 'sig-disjoint',
          sampleBodies: ['totally unrelated patternwords nowherenear thedifff'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions(['something completely orthogonal happening here']) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const dims = dimLines().filter((l) => /Pattern-history layer: 0 matches/.test(l));
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatch(/0\.4/);
  });

  // ─── Substrate row hygiene ──────────────────────────

  it('skips patterns whose sampleBodies array is empty', async () => {
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        // Pattern A — empty bodies; must NOT render.
        { signature: 'sig-empty', sampleBodies: [] },
        // Pattern B — full match; must render.
        {
          signature: 'sig-keeper',
          sampleBodies: ['avoid using async-storage in render-path components'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions(['avoid async-storage render-path components']) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    expect(lines.some((l) => /sig-empty/.test(l))).toBe(false);
    expect(lines.some((l) => /sig-keeper/.test(l))).toBe(true);
  });

  it('skips patterns whose sampleBodies tokenize to an empty significant set', async () => {
    // Substrate `tokenizeForJaccard` drops stopwords + ≤2-char tokens.
    // A body of "the a is to of" yields zero significant tokens —
    // containment is structurally undefined, so we skip.
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        // Pattern A — pure stopwords; must NOT render.
        { signature: 'sig-stopwords', sampleBodies: ['the a is to of and or'] },
        // Pattern B — full match; must render.
        {
          signature: 'sig-realsignal',
          sampleBodies: ['avoid using async-storage in render-path components'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions(['avoid async-storage render-path components']) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    expect(lines.some((l) => /sig-stopwords/.test(l))).toBe(false);
    expect(lines.some((l) => /sig-realsignal/.test(l))).toBe(true);
  });

  it('does NOT touch coveredPatterns[] — only patterns[] are matched', async () => {
    const payload = {
      version: 1,
      lastUpdated: '2026-04-29T00:00:00.000Z',
      thresholdApplied: 5,
      historyDepth: 50,
      prsScanned: ['1700'],
      patterns: [
        // Uncovered — matchable.
        {
          signature: 'sig-uncovered',
          tool: 'coderabbit',
          severityBucket: 'medium',
          occurrences: 3,
          prs: ['1700'],
          sampleBodies: ['avoid using async-storage in render-path components'],
          firstSeen: '2026-04-01T00:00:00.000Z',
          lastSeen: '2026-04-28T00:00:00.000Z',
          paths: [],
          coveredByRule: false,
        },
      ],
      coveredPatterns: [
        // Already covered — must NOT render even though body matches.
        {
          signature: 'sig-covered',
          tool: 'coderabbit',
          severityBucket: 'medium',
          occurrences: 4,
          prs: ['1701'],
          sampleBodies: ['avoid using async-storage in render-path components'],
          firstSeen: '2026-04-01T00:00:00.000Z',
          lastSeen: '2026-04-28T00:00:00.000Z',
          paths: [],
          coveredByRule: true,
        },
      ],
    };
    writeSubstrate(tmpDir, payload);
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions(['avoid async-storage render-path components']) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    expect(lines.some((l) => /sig-uncovered/.test(l))).toBe(true);
    expect(lines.some((l) => /sig-covered/.test(l))).toBe(false);
  });

  // ─── Diff-tokenization edge cases ───────────────────

  it('does not let `+++ b/file.ts` headers poison the diff token pool', async () => {
    // The pattern's only-significant token is the file basename. If the
    // overlay tokenized the `+++ b/foo.ts` header, this would match —
    // it must NOT.
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([{ signature: 'sig-poison', sampleBodies: ['poisonword'] }]),
    );
    // Diff with no real additions — only the +++ file header.
    const diffNoAdditions =
      'diff --git a/poisonword.ts b/poisonword.ts\n' +
      '--- a/poisonword.ts\n' +
      '+++ b/poisonword.ts\n' +
      '@@ -1 +1 @@\n' +
      ' unchanged\n';
    mockGetDiffForReview.mockResolvedValue(diffResult({ diff: diffNoAdditions }));

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    expect(lines.some((l) => /sig-poison/.test(l))).toBe(false);
  });

  it('orders matches by containment desc, then signature asc, deterministically', async () => {
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        // 100% containment (3/3): aaa-pattern.
        {
          signature: 'aaa-pattern',
          sampleBodies: ['lattermost foobaz quuxquux'],
        },
        // 100% containment (3/3): bbb-pattern (same containment as aaa, lex-sorted).
        {
          signature: 'bbb-pattern',
          sampleBodies: ['lattermost foobaz quuxquux'],
        },
        // ~50% containment: ccc-pattern.
        {
          signature: 'ccc-pattern',
          sampleBodies: ['lattermost foobaz quuxquux missing-token-here'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions(['lattermost foobaz quuxquux']) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    const lines = infoLines();
    const aaaIdx = lines.findIndex((l) => /aaa-pattern/.test(l));
    const bbbIdx = lines.findIndex((l) => /bbb-pattern/.test(l));
    const cccIdx = lines.findIndex((l) => /ccc-pattern/.test(l));
    expect(aaaIdx).toBeGreaterThan(-1);
    expect(bbbIdx).toBeGreaterThan(-1);
    expect(cccIdx).toBeGreaterThan(-1);
    // aaa before bbb (lex tiebreak at same containment), bbb before ccc (higher containment).
    expect(aaaIdx).toBeLessThan(bbbIdx);
    expect(bbbIdx).toBeLessThan(cccIdx);
  });

  // ─── No-LLM defense-in-depth (overlay is a static-source-grep target) ──

  it('overlay source has no LLM imports — extends the no-LLM static-source-grep', async () => {
    const estimatePath = path.join(__dirname, 'shield-estimate.ts');
    const source = fs.readFileSync(estimatePath, 'utf-8');
    // Forbidden import paths and symbols specific to the LLM Verification
    // Layer. Mirrors the mmnto-ai/totem#1714 + #1713 patterns.
    expect(source).not.toMatch(/from ['"]@mmnto\/totem-orchestrator['"]/);
    expect(source).not.toMatch(/getOrchestrator/);
    expect(source).not.toMatch(/\bAnthropic\b/);
    expect(source).not.toMatch(/\bOpenAI\b/);
    expect(source).not.toMatch(/\bgemini\b/i);
    // The mmnto-ai/totem#1714 grep already blocks runOrchestrator /
    // requireEmbedding / LanceStore / createEmbedder / `from '../utils.js'`
    // — re-asserting here keeps the overlay's guard intact under future
    // refactors.
    expect(source).not.toMatch(/runOrchestrator/);
    expect(source).not.toMatch(/requireEmbedding/);
    expect(source).not.toMatch(/LanceStore/);
    expect(source).not.toMatch(/createEmbedder/);
  });

  // ─── CR mmnto-ai/totem#1739 R1 (Major) — configRoot path resolution ─

  it('resolves the substrate path relative to configRoot, not cwd', async () => {
    // Substrate written at configRoot (project root). cwd is a nested
    // working dir with no `.totem/` of its own. Pre-fix the overlay would
    // probe `<nestedCwd>/.totem/recurrence-stats.json`, miss, and emit
    // the "skipped" hint — disabling the overlay despite the substrate
    // existing at configRoot. Post-fix the overlay resolves against
    // configRoot and finds the substrate.
    const nestedCwd = path.join(tmpDir, 'nested', 'subdir');
    fs.mkdirSync(nestedCwd, { recursive: true });
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        {
          signature: 'sig-rooted-at-configroot',
          sampleBodies: ['avoid using async-storage in render-path components'],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({
        diff: diffWithAdditions(['avoid async-storage render-path components']),
      }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    // cwd = nested working dir (substrate-empty), configRoot = project root
    // (substrate lives here).
    await runEstimate({ estimate: true }, makeConfig(), nestedCwd, tmpDir);

    const all = [...infoLines(), ...dimLines()];
    expect(all.some((l) => /sig-rooted-at-configroot/.test(l))).toBe(true);
    // Skipped-hint MUST NOT fire — the substrate was found via configRoot.
    expect(all.some((l) => /Pattern-history layer skipped/.test(l))).toBe(false);
  });

  // ─── CR mmnto-ai/totem#1739 R1 (Major) — terminal-injection defense ─

  it('sanitizes ANSI/control bytes in substrate-derived signature, PR list, and sample body', async () => {
    // A tampered substrate could plant CSI sequences (`\x1b[...]`) that
    // spoof cursor moves or color resets when rendered to stderr. Closes
    // the same class CR caught on `retrospect.ts` PR mmnto-ai/totem#1734.
    const ansi = '\x1b[31mRED\x1b[0m';
    const ctrlC0 = '\x07'; // BEL — a C0 control byte
    const ctrlC1 = '\x9b'; // CSI 8-bit equivalent — a C1 control byte
    writeSubstrate(
      tmpDir,
      makeSubstratePayload([
        {
          signature: `sig-${ansi}-aaaa`,
          prs: [`1700${ansi}`, `${ctrlC0}1710`],
          // totem-context: adjacent ${ctrlC0}${ctrlC1} placeholders are an intentional fixture — both C0 (BEL \x07) and C1 (CSI 8-bit \x9b) bytes need to land in the rendered output so the sanitizer test asserts both are stripped. The disjoint-concat rule targets `${a}${b}` token-fusing, not adjacent control-byte fixtures.
          sampleBodies: [`avoid ${ansi} async-storage render-path ${ctrlC0}${ctrlC1} components`],
        },
      ]),
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({
        diff: diffWithAdditions(['avoid async-storage render-path components']),
      }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    // No ESC, BEL (C0), or CSI-8bit (C1) bytes survive sanitization.
    const all = [...infoLines(), ...dimLines(), ...warnLines()];
    for (const line of all) {
      expect(line).not.toContain('\x1b');
      expect(line).not.toContain('\x07');
      expect(line).not.toContain('\x9b');
    }
    // The pattern still rendered — sanitization stripped the unsafe bytes,
    // not the surrounding text.
    expect(all.some((l) => /sig-.*-aaaa/.test(l))).toBe(true);
  });
});

// ─── Runtime orchestrator spy guard (mirrors retrospect.test.ts:546) ──
//
// Static-source inspection alone can be fooled by a transitive import.
// Mock the orchestrator factory module at runtime; if anything in the
// estimate-overlay import chain reaches it, the spy fires. We require
// zero invocations.
const orchestratorSpy = vi.fn();
vi.mock('../orchestrators/orchestrator.js', () => ({
  createOrchestrator: (...args: unknown[]) => {
    orchestratorSpy(...args);
    return () => {
      throw new Error('createOrchestrator must NEVER be called from runEstimate');
    };
  },
  resolveOrchestrator: (...args: unknown[]) => {
    orchestratorSpy(...args);
    throw new Error('resolveOrchestrator must NEVER be called from runEstimate');
  },
}));

describe('runEstimate — runtime orchestrator spy', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-est-spy-'));
    originalCwd = process.cwd();
    orchestratorSpy.mockClear();
    mockGetDiffForReview.mockReset();
    mockRunCompiledRules.mockReset();
    mockRunCompiledRules.mockResolvedValue(runCompiledRulesPassResult());
    for (const fn of Object.values(mockLog)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('never invokes createOrchestrator or resolveOrchestrator across an end-to-end run with the overlay', async () => {
    // Substrate present + matching pattern — exercises the full overlay
    // path. This is the load-bearing assertion: even with the overlay
    // active, the orchestrator spy stays at 0.
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'recurrence-stats.json'),
      JSON.stringify(
        makeSubstratePayload([
          {
            signature: 'sig-spy',
            sampleBodies: ['avoid using async-storage in render-path components'],
          },
        ]),
        null,
        2,
      ),
      'utf-8',
    );
    mockGetDiffForReview.mockResolvedValue(
      diffResult({ diff: diffWithAdditions(['avoid async-storage render-path components']) }),
    );

    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate({ estimate: true }, makeConfig(), tmpDir, tmpDir);

    expect(orchestratorSpy).toHaveBeenCalledTimes(0);
  });
});
