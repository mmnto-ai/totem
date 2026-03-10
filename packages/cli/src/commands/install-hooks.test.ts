import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildPreCommitHook,
  buildPrePushHook,
  installGitHook,
  TOTEM_PRECOMMIT_MARKER,
  TOTEM_PREPUSH_MARKER,
} from './install-hooks.js';

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

  it('bails instantly when compiled-rules.json is missing', () => {
    const hook = buildPrePushHook(shieldCmd);
    expect(hook).toContain('[ ! -f ".totem/compiled-rules.json" ] && exit 0');
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
