import { execFileSync } from 'node:child_process';
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

import { cleanTmpDir } from '../test-utils.js';

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
    cleanTmpDir(tmpDir);
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

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    await expect(verifyManifestCommand()).rejects.toThrow(/[Cc]ompile manifest/);
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

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    await expect(verifyManifestCommand()).rejects.toThrow(/[Cc]ompile manifest/);
  });

  it('passes with valid state', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);

    // Write manifest that matches current disk state
    writeValidManifest(manifestPath, lessonsDir, rulesPath);

    const { verifyManifestCommand } = await import('./verify-manifest.js');

    // Should complete without throwing
    await verifyManifestCommand();
  });
});

// ─── Fingerprint drift tests ────────────────────────────

/**
 * Run a git command in `cwd`. Tests use a real local git repo so the
 * verify-manifest base-ref + branch-diff lookups hit a genuine commit graph
 * rather than a mock. Cheap to set up; vastly more honest than faking
 * child_process.
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

/**
 * Initialize a git repo in `cwd` with `main` as the default branch. Sets a
 * deterministic user identity so commits succeed in CI environments that
 * don't have global git config.
 */
function initGitRepo(cwd: string): void {
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'commit.gpgsign', 'false');
}

describe('verify-manifest fingerprint drift', () => {
  let tmpDir: string;
  let originalCwd: string;
  // Cache the original env so per-test mutations don't leak.
  const originalDriftJustification = process.env['TOTEM_DRIFT_JUSTIFICATION'];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-verify-manifest-drift-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
    // Ensure each test sees a clean env unless it sets the var itself.
    delete process.env['TOTEM_DRIFT_JUSTIFICATION'];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (originalDriftJustification !== undefined) {
      process.env['TOTEM_DRIFT_JUSTIFICATION'] = originalDriftJustification;
    } else {
      delete process.env['TOTEM_DRIFT_JUSTIFICATION'];
    }
  });

  /**
   * Build a manifest fixture pinned to current disk state plus the supplied
   * fingerprint. The `scaffold()` helper above writes lessons + rules; we
   * compute the matching hashes here so input_hash / output_hash always pass.
   */
  function writeManifestWithFingerprint(
    manifestPath: string,
    lessonsDir: string,
    rulesPath: string,
    fingerprint: string | undefined,
  ): void {
    writeCompileManifest(manifestPath, {
      compiled_at: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
      input_hash: generateInputHash(lessonsDir),
      output_hash: generateOutputHash(rulesPath),
      rule_count: 1,
      ...(fingerprint !== undefined ? { compile_worker_fingerprint: fingerprint } : {}),
    });
  }

  /**
   * Seed the compile-worker prompt template file at its monorepo-relative
   * path so `verify-manifest`'s `inMonorepo` detection (existence check on
   * `packages/cli/src/commands/compile-templates.ts`) returns true.
   * Required for all drift-gate tests except the "external user / skip
   * gate" case.
   */
  function seedMonorepoTemplate(
    cwd: string,
    content = 'export const COMPILER_SYSTEM_PROMPT = "base";\n',
  ): string {
    const templatesDir = path.join(cwd, 'packages/cli/src/commands');
    fs.mkdirSync(templatesDir, { recursive: true });
    const templatesPath = path.join(templatesDir, 'compile-templates.ts');
    fs.writeFileSync(templatesPath, content);
    return templatesPath;
  }

  it('passes when local and base fingerprints match', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    seedMonorepoTemplate(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'f'.repeat(64));

    initGitRepo(tmpDir);
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'initial');

    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await verifyManifestCommand();
  });

  it('passes when manifest has no fingerprint (Phase 1 anthropic-only — non-anthropic providers leave it undefined)', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    seedMonorepoTemplate(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, undefined);

    initGitRepo(tmpDir);
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'initial');

    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await verifyManifestCommand();
  });

  // External @mmnto/cli consumers don't own packages/cli/src/commands/
  // compile-templates.ts; firing the drift gate on every CLI upgrade would
  // force them to use --allow-compile-drift for every routine version bump.
  // Scope-detect via template-source existence: when the file isn't present
  // at the monorepo-relative path, skip the gate. The fingerprint is still
  // recorded in their manifest for observability.
  it('skips the drift gate when not running inside the totem monorepo (external user)', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    // Intentionally DO NOT seed packages/cli/src/commands/compile-templates.ts
    // → simulates an external user whose repo doesn't contain the totem
    // monorepo source.

    initGitRepo(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'a'.repeat(64));
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'base on main');

    git(tmpDir, 'checkout', '-q', '-b', 'feature/external-cli-upgrade');
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'b'.repeat(64));
    git(tmpDir, 'add', path.relative(tmpDir, manifestPath).replace(/\\/g, '/'));
    git(tmpDir, 'commit', '-q', '-m', 'fingerprint changed via CLI upgrade');

    // Drift would normally fire — but gate is skipped because the monorepo
    // template source is absent. Should pass without override.
    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await verifyManifestCommand();
  });

  it('fails when fingerprints differ and compile-templates.ts is not in the diff', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    seedMonorepoTemplate(tmpDir);

    initGitRepo(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'a'.repeat(64));
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'base on main');

    git(tmpDir, 'checkout', '-q', '-b', 'feature/no-template-edit');
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'b'.repeat(64));
    // Commit only the manifest, no template file change.
    git(tmpDir, 'add', path.relative(tmpDir, manifestPath).replace(/\\/g, '/'));
    git(tmpDir, 'commit', '-q', '-m', 'unjustified drift');

    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await expect(verifyManifestCommand()).rejects.toThrow(/fingerprint drift/);
  });

  it('passes when fingerprints differ but compile-templates.ts is in the diff', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    const templatesPath = seedMonorepoTemplate(tmpDir);

    initGitRepo(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'a'.repeat(64));
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'base on main');

    git(tmpDir, 'checkout', '-q', '-b', 'feature/with-template-edit');
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'c'.repeat(64));
    fs.writeFileSync(templatesPath, 'export const COMPILER_SYSTEM_PROMPT = "evolved";\n');
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'justified drift');

    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await verifyManifestCommand();
  });

  it('--allow-compile-drift requires TOTEM_DRIFT_JUSTIFICATION when no PR body context is available', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    seedMonorepoTemplate(tmpDir);

    initGitRepo(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'a'.repeat(64));
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'base on main');

    git(tmpDir, 'checkout', '-q', '-b', 'feature/override-no-justification');
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'b'.repeat(64));
    git(tmpDir, 'add', path.relative(tmpDir, manifestPath).replace(/\\/g, '/'));
    git(tmpDir, 'commit', '-q', '-m', 'drift no justification');

    // No remote → gh pr view will fail → falls through to env-var gate.
    // No env var set → override should reject.
    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await expect(verifyManifestCommand({ allowCompileDrift: true })).rejects.toThrow(
      /TOTEM_DRIFT_JUSTIFICATION/,
    );
  });

  it('--allow-compile-drift accepts when TOTEM_DRIFT_JUSTIFICATION is set and no PR body context is available', async () => {
    const { lessonsDir, rulesPath, manifestPath } = scaffold(tmpDir);
    seedMonorepoTemplate(tmpDir);

    initGitRepo(tmpDir);
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'a'.repeat(64));
    git(tmpDir, 'add', '.');
    git(tmpDir, 'commit', '-q', '-m', 'base on main');

    git(tmpDir, 'checkout', '-q', '-b', 'feature/override-with-justification');
    writeManifestWithFingerprint(manifestPath, lessonsDir, rulesPath, 'b'.repeat(64));
    git(tmpDir, 'add', path.relative(tmpDir, manifestPath).replace(/\\/g, '/'));
    git(tmpDir, 'commit', '-q', '-m', 'drift with justification');

    process.env['TOTEM_DRIFT_JUSTIFICATION'] = 'Worker prompt-cache TTL bump per ADR-NNN';

    const { verifyManifestCommand } = await import('./verify-manifest.js');
    await verifyManifestCommand({ allowCompileDrift: true });
  });
});
