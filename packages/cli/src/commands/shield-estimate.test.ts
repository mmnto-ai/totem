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
