import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPreCommitHook,
  buildPrePushHook,
  checkHooksInstalled,
  detectTotemPrefix,
  installGitHook,
  installHooksNonInteractive,
  TOTEM_PRECOMMIT_MARKER,
  TOTEM_PREPUSH_MARKER,
} from './install-hooks.js';

describe('detectTotemPrefix', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-detect-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pnpm exec when pnpm-lock.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('pnpm exec totem');
  });

  it('returns yarn when yarn.lock exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('yarn totem');
  });

  it('returns bunx when bun.lockb exists (legacy)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('bunx totem');
  });

  it('returns bunx when bun.lock exists (Bun >= 1.2)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('bunx totem');
  });

  it('falls back to npx when no lockfile exists', () => {
    expect(detectTotemPrefix(tmpDir)).toBe('npx totem');
  });

  it('prefers pnpm over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('pnpm exec totem');
  });

  it('prefers yarn over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('yarn totem');
  });
});

describe('buildPreCommitHook', () => {
  it('contains the marker for idempotency', () => {
    const hook = buildPreCommitHook();
    expect(hook).toContain(TOTEM_PRECOMMIT_MARKER);
  });

  it('blocks main and master branches', () => {
    const hook = buildPreCommitHook();
    expect(hook).toContain('"main"');
    expect(hook).toContain('"master"');
  });

  it('prints a helpful error message with override instructions', () => {
    const hook = buildPreCommitHook();
    expect(hook).toContain('git checkout -b feat/my-feature');
    expect(hook).toContain('git commit --no-verify');
  });

  it('starts with a shebang', () => {
    const hook = buildPreCommitHook();
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });

  it('exits with code 1 when on protected branch', () => {
    const hook = buildPreCommitHook();
    expect(hook).toContain('exit 1');
  });
});

describe('buildPrePushHook', () => {
  const shieldCmd = 'pnpm exec totem shield --deterministic';

  it('contains the marker for idempotency', () => {
    const hook = buildPrePushHook(shieldCmd);
    expect(hook).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('only runs shield when compiled-rules.json exists (if/fi, safe for appending)', () => {
    const hook = buildPrePushHook(shieldCmd);
    expect(hook).toContain('if [ -f ".totem/compiled-rules.json" ]; then');
    expect(hook).toContain('fi');
    // Must use if/fi guard, NOT `&& exit 0` which would terminate appended hooks early
    expect(hook).not.toContain('&& exit 0');
  });

  it('runs the shield command when rules exist', () => {
    const hook = buildPrePushHook(shieldCmd);
    expect(hook).toContain(shieldCmd);
  });

  it('mentions --no-verify override', () => {
    const hook = buildPrePushHook(shieldCmd);
    expect(hook).toContain('git push --no-verify');
  });

  it('starts with a shebang', () => {
    const hook = buildPrePushHook(shieldCmd);
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });

  it('uses the provided shield command (respects package manager)', () => {
    const npxHook = buildPrePushHook('npx totem shield --deterministic');
    expect(npxHook).toContain('npx totem shield --deterministic');

    const yarnHook = buildPrePushHook('yarn totem shield --deterministic');
    expect(yarnHook).toContain('yarn totem shield --deterministic');
  });
});

describe('installGitHook', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-'));
    hooksDir = path.join(tmpDir, '.git', 'hooks');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a new hook file when none exists', () => {
    const content = buildPreCommitHook();
    const result = installGitHook(hooksDir, 'pre-commit', content, TOTEM_PRECOMMIT_MARKER);

    expect(result).toBe('installed');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    const written = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8');
    expect(written).toContain(TOTEM_PRECOMMIT_MARKER);
  });

  it('creates parent directories as needed', () => {
    expect(fs.existsSync(hooksDir)).toBe(false);

    installGitHook(hooksDir, 'pre-commit', buildPreCommitHook(), TOTEM_PRECOMMIT_MARKER);

    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  it('returns exists when marker is already present (idempotent)', () => {
    const content = buildPreCommitHook();
    installGitHook(hooksDir, 'pre-commit', content, TOTEM_PRECOMMIT_MARKER);

    const result = installGitHook(hooksDir, 'pre-commit', content, TOTEM_PRECOMMIT_MARKER);
    expect(result).toBe('exists');
  });

  it('appends to existing hook without marker (preserves user hooks)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    const userHook = '#!/bin/sh\necho "user hook"\n';
    fs.writeFileSync(hookPath, userHook);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toContain('echo "user hook"');
    expect(written).toContain(TOTEM_PRECOMMIT_MARKER);
    // Should not duplicate shebang when appending
    expect((written.match(/^#!\/bin\/sh$/gm) ?? []).length).toBe(1);
  });

  it('does not clobber existing hook content', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const userHook = '#!/bin/sh\nrun_my_tests\n';
    fs.writeFileSync(hookPath, userHook);

    installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook('npx totem shield --deterministic'),
      TOTEM_PREPUSH_MARKER,
    );

    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toContain('run_my_tests');
    expect(written).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('is idempotent — double install does not duplicate', () => {
    const content = buildPrePushHook('npx totem shield --deterministic');
    installGitHook(hooksDir, 'pre-push', content, TOTEM_PREPUSH_MARKER);
    installGitHook(hooksDir, 'pre-push', content, TOTEM_PREPUSH_MARKER);

    const written = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    const matches = written.match(new RegExp(TOTEM_PREPUSH_MARKER.replace(/[[\]]/g, '\\$&'), 'g'));
    expect(matches).toHaveLength(1);
  });

  it('returns skipped-non-shell for Node hook (does not corrupt file)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    const nodeHook = '#!/usr/bin/env node\nconsole.log("lint");\n'; // totem-ignore — test fixture, not real logging
    fs.writeFileSync(hookPath, nodeHook);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('skipped-non-shell');
    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toBe(nodeHook); // File untouched
  });

  it('returns skipped-non-shell for Python hook', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const pythonHook = '#!/usr/bin/env python3\nimport subprocess\n';
    fs.writeFileSync(hookPath, pythonHook);

    const result = installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook('npx totem shield --deterministic'),
      TOTEM_PREPUSH_MARKER,
    );

    expect(result).toBe('skipped-non-shell');
    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toBe(pythonHook); // File untouched
  });

  it('appends normally to sh hooks', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "existing"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('appends normally to bash hooks', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/bash\necho "existing"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('appends normally to env bash hooks', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho "existing"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('appends to hooks without a shebang (plain text)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, 'echo "no shebang"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('handles pre-commit and pre-push independently', () => {
    installGitHook(hooksDir, 'pre-commit', buildPreCommitHook(), TOTEM_PRECOMMIT_MARKER);
    installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook('pnpm exec totem shield --deterministic'),
      TOTEM_PREPUSH_MARKER,
    );

    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);

    const preCommit = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8');
    const prePush = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    expect(preCommit).toContain(TOTEM_PRECOMMIT_MARKER);
    expect(preCommit).not.toContain(TOTEM_PREPUSH_MARKER);
    expect(prePush).toContain(TOTEM_PREPUSH_MARKER);
    expect(prePush).not.toContain(TOTEM_PRECOMMIT_MARKER);
  });
});

// ─── installHooksNonInteractive ─────────────────────

describe('installHooksNonInteractive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-ni-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when not a git repo', () => {
    const result = installHooksNonInteractive(tmpDir);
    expect(result).toBeNull();
  });

  it('installs all three hooks in a git repo', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    const result = installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');

    // Verify files exist
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
  });

  it('is idempotent — second call returns exists for all hooks', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    installHooksNonInteractive(tmpDir);
    const result = installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('exists');
    expect(result!.prePush).toBe('exists');
    expect(result!.postMerge).toBe('exists');
  });

  it('returns null when hook manager is detected', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.mkdirSync(path.join(tmpDir, '.husky'), { recursive: true });

    const result = installHooksNonInteractive(tmpDir);
    expect(result).toBeNull();
  });

  it('installs hooks at git root when run from a subdirectory', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    const result = installHooksNonInteractive(subDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');

    // Hooks should be at git root, not in the subdirectory
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
    expect(fs.existsSync(path.join(subDir, '.git'))).toBe(false);
  });

  it('check passes from subdirectory after install', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    installHooksNonInteractive(subDir);
    expect(checkHooksInstalled(subDir)).toBe(true);
  });

  it('appends to existing hooks without clobbering', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nrun_my_tests\n');

    const result = installHooksNonInteractive(tmpDir);

    expect(result!.prePush).toBe('appended');
    const content = fs.readFileSync(path.join(tmpDir, '.git', 'hooks', 'pre-push'), 'utf-8');
    expect(content).toContain('run_my_tests');
    expect(content).toContain(TOTEM_PREPUSH_MARKER);
  });
});

// ─── checkHooksInstalled ────────────────────────────

describe('checkHooksInstalled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-check-'));
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no hooks are installed', () => {
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });

  it('returns true when all hooks are installed', () => {
    installHooksNonInteractive(tmpDir);
    expect(checkHooksInstalled(tmpDir)).toBe(true);
  });

  it('returns false when only some hooks are installed', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    installGitHook(hooksDir, 'pre-commit', buildPreCommitHook(), TOTEM_PRECOMMIT_MARKER);
    // Missing pre-push and post-merge
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });

  it('returns false when hook file exists but missing marker', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "no marker"\n');
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/sh\necho "no marker"\n');
    fs.writeFileSync(path.join(hooksDir, 'post-merge'), '#!/bin/sh\necho "no marker"\n');
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });
});
