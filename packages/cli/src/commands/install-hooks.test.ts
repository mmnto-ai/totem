import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildPostCheckoutHookContent,
  buildPreCommitHook,
  buildPrePushHook,
  buildResolveBlock,
  checkHooksInstalled,
  detectTotemPrefix,
  generateHookHelpers,
  getFallbackCommand,
  installGitHook,
  installHooksNonInteractive,
  TOTEM_PRECOMMIT_MARKER,
  TOTEM_PREPUSH_MARKER,
  upgradePrePushHookIfNeeded,
} from './install-hooks.js';

describe('detectTotemPrefix', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-detect-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
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

describe('getFallbackCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-fallback-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns pnpm dlx when pnpm-lock.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(getFallbackCommand(tmpDir)).toBe('pnpm dlx @mmnto/cli');
  });

  it('returns yarn dlx when yarn.lock exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(getFallbackCommand(tmpDir)).toBe('yarn dlx @mmnto/cli');
  });

  it('returns bunx when bun.lockb exists (legacy)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(getFallbackCommand(tmpDir)).toBe('bunx @mmnto/cli');
  });

  it('returns bunx when bun.lock exists (Bun >= 1.2)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(getFallbackCommand(tmpDir)).toBe('bunx @mmnto/cli');
  });

  it('returns npx when only package.json exists (no lockfile)', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(getFallbackCommand(tmpDir)).toBe('npx @mmnto/cli');
  });

  it('returns bare totem when no lockfile and no package.json exist', () => {
    expect(getFallbackCommand(tmpDir)).toBe('totem');
  });

  it('prefers pnpm over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(getFallbackCommand(tmpDir)).toBe('pnpm dlx @mmnto/cli');
  });

  it('prefers yarn over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(getFallbackCommand(tmpDir)).toBe('yarn dlx @mmnto/cli');
  });
});

describe('buildResolveBlock', () => {
  it('uses command -v (not which) to check for totem', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('command -v totem');
    expect(block).not.toContain('which');
  });

  it('sets TOTEM_CMD to totem when found on PATH', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('TOTEM_CMD="totem"');
  });

  it('falls back to provided command when package.json exists', () => {
    const block = buildResolveBlock('yarn dlx @mmnto/cli');
    expect(block).toContain('TOTEM_CMD="yarn dlx @mmnto/cli"');
  });

  it('sets TOTEM_CMD="" when unavailable — never exits early or blocks chained hooks', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('TOTEM_CMD=""');
    expect(block).not.toContain('exit 0');
    expect(block).not.toContain('exit 1');
  });

  it('prints a warning to stderr when totem is not found', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('>&2');
    expect(block).toContain('[Totem]');
  });

  it('checks for package.json before falling back', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('[ -f package.json ]');
  });

  it('prefers pnpm exec totem in workspace before dlx fallback', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('pnpm-workspace.yaml');
    expect(block).toContain('TOTEM_CMD="pnpm exec totem"');
    const workspaceIdx = block.indexOf('pnpm-workspace.yaml');
    const dlxIdx = block.indexOf('pnpm dlx @mmnto/cli');
    expect(workspaceIdx).toBeLessThan(dlxIdx);
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
  it('contains the marker for idempotency', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('starts with a shebang', () => {
    const hook = buildPrePushHook();
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });

  it('mentions --no-verify override', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('git push --no-verify');
  });

  it('only gates when compiled-rules.json exists', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('if [ -f ".totem/compiled-rules.json" ]; then');
  });

  it('checks .lint-passed flag', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('.totem/cache/.lint-passed');
  });

  it('validates lint flag SHA against HEAD', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('git rev-parse HEAD');
    expect(hook).toContain('LINT_SHA');
    expect(hook).toContain('HEAD_SHA');
  });

  it('does not execute any totem commands', () => {
    const hook = buildPrePushHook();
    expect(hook).not.toContain('$TOTEM_CMD');
    // "totem lint" appears in error messages but not as a command invocation
    expect(hook).not.toMatch(/^\s+totem\s+(lint|review|shield|compile)\b/m);
    expect(hook).not.toContain('pnpm');
    expect(hook).not.toContain('node ');
  });

  it('does not include resolve block', () => {
    const hook = buildPrePushHook();
    expect(hook).not.toContain('command -v totem');
    expect(hook).not.toContain('TOTEM_CMD=');
  });

  it('uses POSIX-compatible syntax only', () => {
    const hook = buildPrePushHook();
    // Must use [ ] not [[ ]]
    expect(hook).not.toContain('[[');
    expect(hook).not.toContain(']]');
  });

  it('prints actionable error messages when blocking', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('Push blocked');
    expect(hook).toContain('/prepush');
  });

  it('prints diagnostic details when source files changed', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('Changed files');
  });

  it('prints SHA mismatch details on non-ancestor block', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('lint SHA');
    expect(hook).toContain('HEAD SHA');
  });

  it('includes ancestry-aware lint validation', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('git merge-base --is-ancestor');
    expect(hook).toContain('LINT_SHA');
  });

  it('reads target globs from cache file', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('.totem/cache/.target-globs');
    expect(hook).toContain('TARGET_GLOBS');
  });

  it('falls back to common source extensions when no target-globs cache', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('*.ts *.tsx *.js *.jsx');
  });

  it('uses git diff to check for source file changes', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('git diff --name-only');
    expect(hook).toContain('SRC_CHANGES');
  });

  it('handles non-ancestor commits (rebase)', () => {
    const hook = buildPrePushHook();
    expect(hook).toContain('non-ancestor');
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
    cleanTmpDir(tmpDir);
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

    installGitHook(hooksDir, 'pre-push', buildPrePushHook(), TOTEM_PREPUSH_MARKER);

    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toContain('run_my_tests');
    expect(written).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('is idempotent — double install does not duplicate', () => {
    const content = buildPrePushHook();
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

    const result = installGitHook(hooksDir, 'pre-push', buildPrePushHook(), TOTEM_PREPUSH_MARKER);

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
    installGitHook(hooksDir, 'pre-push', buildPrePushHook(), TOTEM_PREPUSH_MARKER);

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

// ─── generateHookHelpers ────────────────────────────

describe('generateHookHelpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-helpers-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates .totem/hooks/ directory and writes all 4 .sh files', () => {
    generateHookHelpers(tmpDir, 'pnpm dlx @mmnto/cli');

    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'post-merge.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-checkout.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push.sh'))).toBe(true);
  });

  it('generated scripts contain expected content', () => {
    generateHookHelpers(tmpDir, 'pnpm dlx @mmnto/cli');

    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    const postMerge = fs.readFileSync(path.join(hooksDir, 'post-merge.sh'), 'utf-8');
    expect(postMerge).toContain('command -v totem');
    expect(postMerge).toContain('$TOTEM_CMD');

    const prePush = fs.readFileSync(path.join(hooksDir, 'pre-push.sh'), 'utf-8');
    expect(prePush).toContain(TOTEM_PREPUSH_MARKER);
    expect(prePush).toContain('.lint-passed');
  });

  it('is idempotent — calling twice does not error', () => {
    generateHookHelpers(tmpDir, 'pnpm dlx @mmnto/cli');
    generateHookHelpers(tmpDir, 'pnpm dlx @mmnto/cli');

    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'post-merge.sh'))).toBe(true);
  });
});

// ─── installHooksNonInteractive ─────────────────────

describe('installHooksNonInteractive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-ni-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns null when not a git repo', () => {
    const result = installHooksNonInteractive(tmpDir);
    expect(result).toBeNull();
  });

  it('installs all four hooks in a git repo', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    const result = installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');
    expect(result!.postCheckout).toBe('installed');

    // Verify files exist
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-checkout'))).toBe(true);
  });

  it('is idempotent — second call returns exists for all hooks', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    installHooksNonInteractive(tmpDir);
    const result = installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('exists');
    expect(result!.prePush).toBe('exists');
    expect(result!.postMerge).toBe('exists');
    expect(result!.postCheckout).toBe('exists');
  });

  it('returns null and generates helper scripts when hook manager is detected', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.mkdirSync(path.join(tmpDir, '.husky'), { recursive: true });

    const result = installHooksNonInteractive(tmpDir);
    expect(result).toBeNull();

    // Verify helper scripts were generated
    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'post-merge.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push.sh'))).toBe(true);
  });

  it('installs hooks at git root when run from a subdirectory', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    const result = installHooksNonInteractive(subDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');
    expect(result!.postCheckout).toBe('installed');

    // Hooks should be at git root, not in the subdirectory
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-checkout'))).toBe(true);
    expect(fs.existsSync(path.join(subDir, '.git'))).toBe(false);
  });

  it('check passes from subdirectory after install', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    installHooksNonInteractive(subDir);
    expect(checkHooksInstalled(subDir)).toBe(true);
  });

  it('appends to existing hooks without clobbering', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
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
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
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
    fs.writeFileSync(path.join(hooksDir, 'post-checkout'), '#!/bin/sh\necho "no marker"\n');
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });
});

// ─── post-merge hook content (conditional diff-tree) ─

describe('post-merge hook content', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-pm-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('generates post-merge hook with git diff-tree lesson check', () => {
    installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('ORIG_HEAD');
    expect(content).toContain('grep -q');
    expect(content).toContain('.totem/lessons/');
    expect(content).toContain('if ');
    expect(content).toContain('fi');
    expect(content).toContain('[totem] post-merge hook');
    expect(content).toContain('[totem] end post-merge');
  });

  it('passes quiet flag to sync command in post-merge hook', () => {
    installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('--quiet');
  });

  it('preserves existing hooks when appending post-merge block', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'post-merge'), '#!/bin/sh\necho "my custom hook"\n');

    installHooksNonInteractive(tmpDir);

    const content = fs.readFileSync(path.join(hooksDir, 'post-merge'), 'utf-8');
    expect(content).toContain('echo "my custom hook"');
    expect(content).toContain('[totem] post-merge hook');
    expect(content).toContain('ORIG_HEAD');
    expect(content).toContain('fi');
  });
});

// ─── post-checkout hook content (branch switch guard) ─

describe('post-checkout hook content', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-pc-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('generates post-checkout hook with branch switch guard', () => {
    installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-checkout');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('$3');
    expect(content).toContain('exit 0');
    expect(content).toContain('[totem] post-checkout hook');
    expect(content).toContain('[totem] end post-checkout');
  });

  it('handles null SHA for initial checkout', () => {
    const hook = buildPostCheckoutHookContent('pnpm dlx @mmnto/cli');

    expect(hook).toContain('0000000000000000000000000000000000000000');
    expect(hook).toContain('.totem');
  });

  it('uses quiet sync command', () => {
    installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-checkout');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('--quiet');
  });

  it('includes post-checkout in non-interactive install', () => {
    const result = installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.postCheckout).toBe('installed');
  });
});

// ─── upgradePrePushHookIfNeeded ───────────────────────

describe('upgradePrePushHookIfNeeded', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-upgrade-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /**
   * Helper: extract the totem block from a hook file and compare it against
   * the canonical output of buildPrePushHook() (shebang stripped, trimmed).
   * Catches stale shell fragments or splice boundary bugs that toContain would miss.
   */
  function extractTotemBlock(hookContent: string): string {
    const markerIdx = hookContent.indexOf(`# ${TOTEM_PREPUSH_MARKER}`);
    if (markerIdx === -1) return '';

    const afterMarker = hookContent.slice(markerIdx);
    const ifFiPattern = /^\s*(if\s|fi\s*$)/gm;
    let depth = 0;
    let endOffset = -1;
    let firstIfFound = false;
    let match;
    while ((match = ifFiPattern.exec(afterMarker)) !== null) {
      const keyword = match[1]!.trim();
      if (keyword.startsWith('if')) {
        if (!firstIfFound) firstIfFound = true;
        depth++;
      } else if (keyword === 'fi' && firstIfFound) {
        depth--;
      }
      if (firstIfFound && depth === 0) {
        endOffset = match.index + match[0].length;
        break;
      }
    }
    if (endOffset === -1) return '';
    return hookContent.slice(markerIdx, markerIdx + endOffset).trim();
  }

  /** Canonical totem block: shebang stripped, trimmed — the expected upgrade output. */
  function expectedTotemBlock(): string {
    return buildPrePushHook()
      .replace(/^#!\/bin\/sh\n/, '')
      .trim();
  }

  it('upgrades old command-executing hook to flag-checking format', () => {
    // Install an old-style hook that executes $TOTEM_CMD lint
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    const upgraded = upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(content).toContain('.lint-passed');
    expect(content).not.toContain('$TOTEM_CMD');
    expect(content).toContain(TOTEM_PREPUSH_MARKER);

    // Full block comparison: extracted totem block must match canonical output
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('skips hook without totem marker', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const userHook = '#!/bin/sh\necho "user hook"\n';
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), userHook);

    const upgraded = upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(false);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(content).toBe(userHook); // File untouched
  });

  it('skips hook that already uses flag-checking format', () => {
    // Install the current-version hook via non-interactive installer
    installHooksNonInteractive(tmpDir);

    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    const beforeContent = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    const upgraded = upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(false);
    const afterContent = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(afterContent).toBe(beforeContent); // File untouched
  });

  it('returns false when no pre-push hook exists', () => {
    const upgraded = upgradePrePushHookIfNeeded(tmpDir);
    expect(upgraded).toBe(false);
  });

  it('returns false when not a git repo', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-no-git-'));
    try {
      const upgraded = upgradePrePushHookIfNeeded(nonGitDir);
      expect(upgraded).toBe(false);
    } finally {
      cleanTmpDir(nonGitDir);
    }
  });

  it('preserves user-appended content when upgrading', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Simulate an old totem hook with user content appended after it
    const oldTotemBlock = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    const userAppended =
      '\n# My custom deploy notification\ncurl -X POST https://hooks.example.com/deploy\n';
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldTotemBlock + userAppended);

    const upgraded = upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    // New totem block should use flag-checking format
    expect(content).toContain('.lint-passed');
    expect(content).not.toContain('$TOTEM_CMD');
    // User content should be preserved
    expect(content).toContain('curl -X POST https://hooks.example.com/deploy');
    expect(content).toContain('My custom deploy notification');

    // Full block comparison: extracted totem block must match canonical output
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('preserves user-appended if/fi blocks without corrupting them', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Old totem block (needs upgrade) PLUS user content that contains its own if/fi structures
    const oldTotemBlock = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    const userIfFiBlock = `
# Custom deploy guard with nested if/fi
if [ -f ".deploy-lock" ]; then
  echo "Deploy locked, skipping notification"
  if [ "$FORCE_DEPLOY" = "1" ]; then
    echo "Force deploy override"
    curl -X POST https://hooks.example.com/force-deploy
  fi
else
  curl -X POST https://hooks.example.com/deploy
fi

# Another independent if block
if [ -n "$SLACK_WEBHOOK" ]; then
  curl -X POST "$SLACK_WEBHOOK" -d '{"text":"pushing..."}'
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldTotemBlock + userIfFiBlock);

    const upgraded = upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    // Totem block must match canonical output exactly
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());

    // User if/fi structures must survive intact — check exact fragments
    expect(content).toContain('if [ -f ".deploy-lock" ]; then');
    expect(content).toContain('if [ "$FORCE_DEPLOY" = "1" ]; then');
    expect(content).toContain('curl -X POST https://hooks.example.com/force-deploy');
    expect(content).toContain('curl -X POST https://hooks.example.com/deploy');
    expect(content).toContain('if [ -n "$SLACK_WEBHOOK" ]; then');
    expect(content).toContain('curl -X POST "$SLACK_WEBHOOK"');

    // The user block should appear AFTER the totem block, not interleaved
    const totemBlockEnd = content.indexOf(actual) + actual.length;
    const userBlockStart = content.indexOf('# Custom deploy guard');
    expect(userBlockStart).toBeGreaterThan(totemBlockEnd);
  });

  it('leaves no stale fi or orphaned shell fragments after upgrade', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    upgradePrePushHookIfNeeded(tmpDir);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    // Count if/fi balance: every `if` must have a matching `fi`
    const ifMatches = content.match(/^\s*if\s/gm) ?? [];
    const fiMatches = content.match(/^\s*fi\s*$/gm) ?? [];
    expect(ifMatches.length).toBe(fiMatches.length);

    // No duplicate markers — upgrade must not leave the old marker behind
    const markerPattern = new RegExp(TOTEM_PREPUSH_MARKER.replace(/[[\]]/g, '\\$&'), 'g');
    const markerHits = content.match(markerPattern) ?? [];
    expect(markerHits.length).toBe(1);

    // Full block comparison as final sanity check
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('upgrades hook with auto-refresh and $TOTEM_CMD to flag-checking format', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Simulate a hook with the auto-refresh logic still using $TOTEM_CMD
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    if ! $TOTEM_CMD lint; then
      exit 1
    fi
  fi

  if [ -f ".totem/cache/.shield-passed" ] && [ -n "$TOTEM_CMD" ]; then
    SHIELD_SHA=$(cat .totem/cache/.shield-passed | tr -d '[:space:]')
    HEAD_SHA=$(git rev-parse HEAD)
    if [ "$SHIELD_SHA" != "$HEAD_SHA" ]; then
      echo "[totem] Shield flag stale. Auto-refreshing..."
      if ! $TOTEM_CMD review; then
        echo "[totem] Review auto-refresh failed. Fix issues and retry."
        exit 1
      fi
    fi
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    const upgraded = upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    // Must not contain any $TOTEM_CMD — new format is read-only
    expect(content).not.toContain('$TOTEM_CMD');
    expect(content).toContain('.lint-passed');
    // Full block comparison
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });
});
