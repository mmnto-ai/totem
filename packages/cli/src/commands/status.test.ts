import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateInputHash, writeCompileManifest } from '@mmnto/totem';

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
  };
});

// ─── Mock safeExec for git commands ─────────────────────

const mockSafeExec = vi.fn();

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: (...args: unknown[]) => mockSafeExec(...args),
  };
});

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-status-'));
}

function scaffold(cwd: string) {
  const totemDir = path.join(cwd, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  const cacheDir = path.join(totemDir, 'cache');
  const manifestPath = path.join(totemDir, 'compile-manifest.json');

  fs.mkdirSync(lessonsDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  fs.writeFileSync(
    path.join(lessonsDir, 'lesson-1.md'),
    '# Lesson — Always use const\n\n**Tags:** best-practice\n\nPrefer `const` over `let`.\n',
  );

  return { totemDir, lessonsDir, manifestPath, cacheDir };
}

// ─── Tests ──────────────────────────────────────────────

describe('statusCommand', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');

    // Default git mock behavior
    mockSafeExec.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main';
      if (cmd === 'git' && args[0] === 'status') return '';
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123';
      return '';
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
    mockSafeExec.mockReset();
  });

  it('prints branch and rule count', async () => {
    const { lessonsDir, manifestPath } = scaffold(tmpDir);
    const inputHash = generateInputHash(lessonsDir);
    writeCompileManifest(manifestPath, {
      compiled_at: new Date().toISOString(),
      model: 'test',
      input_hash: inputHash,
      output_hash: 'abc',
      rule_count: 5,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { statusCommand } = await import('./status.js');
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Branch: main');
    expect(output).toContain('Rules: 5 compiled');
  });

  it('reports stale manifest when hashes differ', async () => {
    const { manifestPath } = scaffold(tmpDir);
    writeCompileManifest(manifestPath, {
      compiled_at: new Date().toISOString(),
      model: 'test',
      input_hash: 'old-hash-that-does-not-match',
      output_hash: 'abc',
      rule_count: 3,
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { statusCommand } = await import('./status.js');
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Manifest: stale');
  });

  it('reports shield passed when flag matches HEAD', async () => {
    const { cacheDir } = scaffold(tmpDir);
    fs.writeFileSync(path.join(cacheDir, '.shield-passed'), 'abc123', 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { statusCommand } = await import('./status.js');
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Shield: passed');
  });

  it('reports shield stale when flag is old commit', async () => {
    const { cacheDir } = scaffold(tmpDir);
    fs.writeFileSync(path.join(cacheDir, '.shield-passed'), 'old-sha-that-differs', 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { statusCommand } = await import('./status.js');
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Shield: stale');
  });

  it('handles missing .totem directory gracefully', async () => {
    // No scaffold — no .totem dir at all
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { statusCommand } = await import('./status.js');
    await statusCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Rules: 0 compiled');
    expect(output).toContain('Lessons: 0');
    expect(output).toContain('Manifest: missing');
    expect(output).toContain('Shield: missing');
  });
});
