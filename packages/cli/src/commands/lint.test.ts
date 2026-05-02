import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateInputHash, generateOutputHash, writeCompileManifest } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';

// ─── Mock utils to bypass real config loading ───────────

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

// ─── Mock git to return a diff so lint proceeds ─────────

vi.mock('../git.js', () => ({
  getDiffForReview: async () => ({ diff: '' }),
}));

// ─── Mock run-compiled-rules to avoid needing real rules ─

vi.mock('./run-compiled-rules.js', () => ({
  runCompiledRules: async () => ({
    violations: [],
    rules: [],
    output: '',
    findings: [],
    regexTimeouts: [],
  }),
}));

// ─── Mock bootstrap-engine (mmnto-ai/totem#1794) ────────
// Real bootstrapEngine would read .totem/installed-packs.json from the
// scaffolded tmp dir — out of scope for staleness tests. Spy lets the
// dedicated describe block below assert the call sequence.

const bootstrapEngineMock = vi.fn();
vi.mock('../utils/bootstrap-engine.js', () => ({
  bootstrapEngine: (config: unknown, projectRoot: unknown) =>
    bootstrapEngineMock(config, projectRoot),
}));

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lint-'));
}

function scaffold(cwd: string) {
  const totemDir = path.join(cwd, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const manifestPath = path.join(totemDir, 'compile-manifest.json');

  fs.mkdirSync(lessonsDir, { recursive: true });

  fs.writeFileSync(
    path.join(lessonsDir, 'lesson-1.md'),
    '# Lesson — Always use const\n\n**Tags:** best-practice\n\nPrefer `const` over `let`.\n',
  );

  fs.writeFileSync(
    rulesPath,
    JSON.stringify({ rules: [{ id: 'r1', pattern: 'let ', message: 'Use const' }] }, null, 2) +
      '\n',
  );

  return { totemDir, lessonsDir, rulesPath, manifestPath };
}

function writeValidManifest(manifestPath: string, lessonsDir: string, rulesPath: string) {
  writeCompileManifest(manifestPath, {
    compiled_at: new Date().toISOString(),
    model: 'test-model',
    input_hash: generateInputHash(lessonsDir),
    output_hash: generateOutputHash(rulesPath),
    rule_count: 1,
  });
}

// ─── Tests ──────────────────────────────────────────────

describe('lintCommand staleness check', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('warns when compile manifest is stale', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    // Add a new lesson to make manifest stale
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-2.md'),
      '# Lesson — New lesson\n\n**Tags:** new\n\nSomething new.\n',
    );

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lintCommand } = await import('./lint.js');
    await lintCommand({});

    const staleWarning = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes('Compile manifest is stale'),
    );
    expect(staleWarning).toBeDefined();
  });

  it('does not warn when manifest is up to date', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lintCommand } = await import('./lint.js');
    await lintCommand({});

    const staleWarning = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes('Compile manifest is stale'),
    );
    expect(staleWarning).toBeUndefined();
  });

  it('does not warn when no manifest exists', async () => {
    scaffold(tmpDir);
    // No manifest written

    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lintCommand } = await import('./lint.js');
    await lintCommand({});

    const staleWarning = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes('Compile manifest is stale'),
    );
    expect(staleWarning).toBeUndefined();
  });

  it('does not crash lint when staleness check throws', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    // Corrupt the manifest to make readCompileManifest throw
    fs.writeFileSync(manifestPath, '{ invalid json', 'utf-8');

    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lintCommand } = await import('./lint.js');

    // Should not throw — staleness check is wrapped in try/catch
    await expect(lintCommand({})).resolves.toBeUndefined();
  });
});

// ─── Regex timeout strict/lenient mode (mmnto-ai/totem#1641) ────

describe('lintCommand regex timeout handling', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    writeValidManifest(manifestPath, lessonsDir, rulesPath);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('throws TotemError in strict mode when regex timeouts are present', async () => {
    vi.doMock('./run-compiled-rules.js', () => ({
      runCompiledRules: async () => ({
        violations: [],
        rules: [],
        output: '',
        findings: [],
        regexTimeouts: [
          { ruleHash: 'hungRule', file: 'app.ts', elapsedMs: 120, mode: 'strict' as const },
        ],
      }),
    }));

    const { lintCommand } = await import('./lint.js');
    await expect(lintCommand({ timeoutMode: 'strict' })).rejects.toThrow(
      /Regex evaluation timed out/,
    );
  });

  it('does not throw in lenient mode even when regex timeouts are present', async () => {
    vi.doMock('./run-compiled-rules.js', () => ({
      runCompiledRules: async () => ({
        violations: [],
        rules: [],
        output: '',
        findings: [],
        regexTimeouts: [
          { ruleHash: 'hungRule', file: 'app.ts', elapsedMs: 120, mode: 'lenient' as const },
        ],
      }),
    }));

    const { lintCommand } = await import('./lint.js');
    await expect(lintCommand({ timeoutMode: 'lenient' })).resolves.toBeUndefined();
  });

  it('does not throw in strict mode when regex timeouts array is empty', async () => {
    // Locks in that the strict-mode throw fires ONLY on non-empty timeouts,
    // not on every strict-mode run.
    vi.doMock('./run-compiled-rules.js', () => ({
      runCompiledRules: async () => ({
        violations: [],
        rules: [],
        output: '',
        findings: [],
        regexTimeouts: [],
      }),
    }));

    const { lintCommand } = await import('./lint.js');
    await expect(lintCommand({ timeoutMode: 'strict' })).resolves.toBeUndefined();
  });
});

// ─── Engine bootstrap wiring (mmnto-ai/totem#1794) ──────

describe('lintCommand engine bootstrap wiring', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
    bootstrapEngineMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('invokes bootstrapEngine exactly once with the resolved config + configRoot', async () => {
    const { lintCommand } = await import('./lint.js');
    await lintCommand({});

    expect(bootstrapEngineMock).toHaveBeenCalledTimes(1);
    const [calledConfig, calledRoot] = bootstrapEngineMock.mock.calls[0];
    expect(calledConfig).toMatchObject({ totemDir: '.totem' });
    expect(typeof calledRoot).toBe('string');
    expect((calledRoot as string).length).toBeGreaterThan(0);
  });
});
