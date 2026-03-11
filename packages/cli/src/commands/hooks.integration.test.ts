/**
 * Integration tests for the `totem hooks` CLI entrypoint.
 *
 * Spawns the CLI as a child process to test stdout/stderr output,
 * exit codes, and real git repository interactions. Uses os.tmpdir()
 * for isolation to prevent resolveGitRoot from climbing to the real repo.
 *
 * Run locally:
 *   pnpm --filter @mmnto/cli vitest run -c vitest.integration.config.ts hooks
 *
 * @see https://github.com/mmnto-ai/totem/issues/334
 */
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ─── Helpers ────────────────────────────────────────────

const CLI_PATH = path.resolve(__dirname, '../../dist/index.js');

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runHooks(cwd: string, args: string[] = []): RunResult {
  const result = spawnSync('node', [CLI_PATH, 'hooks', ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 15_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('totem hooks CLI entrypoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-int-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints "not a git repository" outside a git repo', () => {
    const result = runHooks(tmpDir);
    expect(result.stderr).toContain('Not a git repository');
    expect(result.exitCode).toBe(0);
  });

  it('--check exits 0 outside a git repo', () => {
    const result = runHooks(tmpDir, ['--check']);
    expect(result.stderr).toContain('Not a git repository');
    expect(result.exitCode).toBe(0);
  });

  it('installs hooks in a fresh git repo', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const result = runHooks(tmpDir);
    expect(result.exitCode).toBe(0);

    // Verify hook files exist
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
  });

  it('--check exits 0 after hooks are installed', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    // Install first
    runHooks(tmpDir);

    // Check should pass
    const result = runHooks(tmpDir, ['--check']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('All hooks installed');
  });

  it('--check exits 1 when hooks are missing', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const result = runHooks(tmpDir, ['--check']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Some hooks are missing');
  });

  it('installs hooks from a monorepo subdirectory', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    const result = runHooks(subDir);
    expect(result.exitCode).toBe(0);

    // Hooks should be at git root, not in subdirectory
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(subDir, '.git'))).toBe(false);
  });

  it('--check passes from a monorepo subdirectory after install', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    // Install from root
    runHooks(tmpDir);

    // Check from subdirectory
    const result = runHooks(subDir, ['--check']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('All hooks installed');
  });
});
