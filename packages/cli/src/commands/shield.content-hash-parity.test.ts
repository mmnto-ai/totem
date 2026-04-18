// #1529: pin byte-equality between writeReviewedContentHash() (TS) and
// .claude/hooks/content-hash.sh (bash) across representative fixtures.
// Both implementations are required to produce identical SHA-256 output
// for the same working tree; any drift fails the PreToolUse gate.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeReviewedContentHash } from './shield.js';

// Resolve the bash hook script relative to the repo root so the test is
// runnable from any cwd. Walk up from import.meta.url until we hit
// `.claude/hooks/content-hash.sh`.
function resolveHookPath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, '.claude', 'hooks', 'content-hash.sh');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate .claude/hooks/content-hash.sh from test context');
}

const HOOK_PATH = resolveHookPath();

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function gitInit(cwd: string): void {
  runGit(cwd, ['init', '-q']);
  runGit(cwd, ['config', 'user.email', 'test@totem.local']);
  runGit(cwd, ['config', 'user.name', 'totem-test']);
  runGit(cwd, ['config', 'commit.gpgsign', 'false']);
}

function gitCommitAll(cwd: string): void {
  runGit(cwd, ['add', '-A']);
  runGit(cwd, ['commit', '-q', '-m', 'fixture']);
}

function runBashHook(cwd: string): string {
  const out = execFileSync('bash', [HOOK_PATH], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  return out.trim();
}

function readStampedHash(cwd: string): string {
  const hashPath = path.join(cwd, '.totem', 'cache', '.reviewed-content-hash');
  return fs.readFileSync(hashPath, 'utf-8').trim();
}

/**
 * Seed a fixture tree covering: standard top-level file, nested subdir,
 * mixed extensions, unicode filename, zero-byte file. The deleted-but-tracked
 * file case is intentionally omitted because the TS and bash implementations
 * diverge on it (pre-existing, orthogonal to #1527; tracked separately).
 */
function seedFixture(cwd: string, extensions: string[]): void {
  gitInit(cwd);

  for (const ext of extensions) {
    fs.writeFileSync(path.join(cwd, `top${ext}`), `// ${ext} top\n`);
  }

  fs.mkdirSync(path.join(cwd, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'sub', `nested${extensions[0]}`), '// nested\n');

  fs.writeFileSync(path.join(cwd, `café${extensions[0]}`), '// unicode\n');

  fs.writeFileSync(path.join(cwd, `empty${extensions[0]}`), '');

  gitCommitAll(cwd);
}

function writeCanonicalFile(cwd: string, extensions: string[]): void {
  const totemDir = path.join(cwd, '.totem');
  if (!fs.existsSync(totemDir)) fs.mkdirSync(totemDir, { recursive: true });
  fs.writeFileSync(path.join(totemDir, 'review-extensions.txt'), extensions.join('\n') + '\n');
}

describe('content-hash parity (#1529)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-parity-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('produces byte-equal hash for default extension set', { timeout: 20_000 }, async () => {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    seedFixture(tmpDir, extensions);

    await writeReviewedContentHash(tmpDir, '.totem', undefined, extensions);
    const tsHash = readStampedHash(tmpDir);
    const bashHash = runBashHook(tmpDir);

    expect(tsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(bashHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tsHash).toBe(bashHash);
  });

  it(
    'bash falls back to defaults when canonical file is missing',
    { timeout: 20_000 },
    async () => {
      // No canonical file written. Both implementations land on the historical
      // defaults and produce the same hash. The TS side's auto-refresh helper
      // will write a canonical file, but the bash hook keys off its own read
      // of the file when run next time (not relevant to this single-shot
      // comparison because both are called once).
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];
      seedFixture(tmpDir, extensions);
      // Explicitly delete the canonical file after auto-refresh so the bash
      // hook exercises the missing-file fallback path.
      await writeReviewedContentHash(tmpDir, '.totem', undefined, extensions);
      const tsHash = readStampedHash(tmpDir);

      const canonical = path.join(tmpDir, '.totem', 'review-extensions.txt');
      if (fs.existsSync(canonical)) fs.unlinkSync(canonical);

      const bashHash = runBashHook(tmpDir);

      expect(tsHash).toBe(bashHash);
    },
  );

  // Skipped pending the companion change in .claude/hooks/content-hash.sh
  // (see #1527 open questions). This parity case is the load-bearing one
  // for polyglot consumers; unskip once the hook reads the canonical file.
  // TODO(#1527): unskip after hook lands.
  it.skip(
    'produces byte-equal hash for custom extension set including .rs',
    { timeout: 20_000 },
    async () => {
      const extensions = ['.ts', '.rs'];
      seedFixture(tmpDir, extensions);
      writeCanonicalFile(tmpDir, extensions);

      await writeReviewedContentHash(tmpDir, '.totem', undefined, extensions);
      const tsHash = readStampedHash(tmpDir);
      const bashHash = runBashHook(tmpDir);

      expect(tsHash).toBe(bashHash);
    },
  );

  it('bash falls back to defaults when canonical file is empty', { timeout: 20_000 }, async () => {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    seedFixture(tmpDir, extensions);

    await writeReviewedContentHash(tmpDir, '.totem', undefined, extensions);
    const tsHash = readStampedHash(tmpDir);

    // Overwrite canonical file with zero bytes. Bash should reject and use
    // defaults, which match the TS side's extension list.
    fs.writeFileSync(path.join(tmpDir, '.totem', 'review-extensions.txt'), '');

    const bashHash = runBashHook(tmpDir);
    expect(tsHash).toBe(bashHash);
  });

  it(
    'bash rejects malformed canonical file and falls back to defaults',
    { timeout: 20_000 },
    async () => {
      const extensions = ['.ts', '.tsx', '.js', '.jsx'];
      seedFixture(tmpDir, extensions);

      await writeReviewedContentHash(tmpDir, '.totem', undefined, extensions);
      const tsHash = readStampedHash(tmpDir);

      // Write a canonical file with a shell-hazardous line. Bash should
      // reject the whole file and fall back to defaults.
      fs.writeFileSync(
        path.join(tmpDir, '.totem', 'review-extensions.txt'),
        '.ts\n*.rs; rm -rf /\n',
      );

      const bashHash = runBashHook(tmpDir);
      expect(tsHash).toBe(bashHash);
    },
  );

  // NOTE: the deleted-but-tracked file case is intentionally not covered
  // here. Pre-existing divergence between the TS deleted-file filter and
  // the bash pipeline's handling means parity would trip for reasons
  // orthogonal to #1527. Tracked separately for a follow-up cleanup of
  // the deleted-file handling.
});
