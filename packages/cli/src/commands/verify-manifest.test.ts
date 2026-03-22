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
    }),
  };
});

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-verify-manifest-'));
}

/**
 * Scaffold a minimal .totem directory with lessons and compiled rules.
 * Returns resolved paths for manifest, rules, and lessons dir.
 */
function scaffold(cwd: string) {
  const totemDir = path.join(cwd, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const manifestPath = path.join(totemDir, 'compile-manifest.json');

  fs.mkdirSync(lessonsDir, { recursive: true });

  // Write a sample lesson
  fs.writeFileSync(
    path.join(lessonsDir, 'lesson-1.md'),
    '# Lesson — Always use const\n\n**Tags:** best-practice\n\nPrefer `const` over `let`.\n',
  );

  // Write a valid compiled-rules.json
  fs.writeFileSync(
    rulesPath,
    JSON.stringify({ rules: [{ id: 'r1', pattern: 'let ', message: 'Use const' }] }, null, 2) +
      '\n',
  );

  return { totemDir, lessonsDir, rulesPath, manifestPath };
}

/**
 * Write a valid manifest that matches the current lessons + rules on disk.
 */
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

describe('verify-manifest', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Write a dummy config file so resolveConfigPath doesn't fail
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects when manifest is missing', async () => {
    scaffold(tmpDir);
    // No manifest written — readCompileManifest should throw

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    await expect(verifyManifestCommand()).rejects.toThrow(/[Cc]ompile manifest/);
  });

  it('rejects forged output_hash', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);

    // Write a valid manifest
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    // Now tamper with compiled-rules.json after manifest was written
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({ rules: [{ id: 'r1', pattern: 'TAMPERED', message: 'evil' }] }, null, 2) +
        '\n',
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    await expect(verifyManifestCommand()).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects when lessons changed since compile', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);

    // Write a valid manifest
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    // Now add a new lesson after manifest was written
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-2.md'),
      '# Lesson — New lesson\n\n**Tags:** new\n\nSomething new.\n',
    );

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    await expect(verifyManifestCommand()).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('passes with valid state', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);

    // Write manifest that matches current disk state
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    // Should complete without throwing or calling process.exit
    await verifyManifestCommand();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
