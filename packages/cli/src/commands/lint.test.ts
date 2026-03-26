import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateInputHash, generateOutputHash, writeCompileManifest } from '@mmnto/totem';

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
  runCompiledRules: async () => ({ violations: [], rules: [], output: '' }),
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
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
