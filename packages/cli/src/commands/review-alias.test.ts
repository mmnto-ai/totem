import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

/**
 * Integration tests for the `review` command registration and
 * the deprecated `shield` alias. Uses the built CLI dist output.
 *
 * The spawn cwd is a freshly-created tmp directory outside the totem repo so
 * `shieldCommand`'s silent `upgradePrePushHookIfNeeded` resolves a null git
 * root and short-circuits — without that isolation the test mutates the real
 * `.git/hooks/pre-push` mid-run (mmnto-ai/totem#1942).
 */
describe('review command alias', () => {
  // Resolve dist path against the test's working directory BEFORE we switch
  // spawn cwd — `path.resolve` snapshots cwd, so the absolute dist path
  // remains stable even when child processes run from elsewhere.
  const distEntry = path.resolve(process.cwd(), 'dist/index.js');

  let isolatedCwd: string;

  beforeAll(() => {
    isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-review-alias-'));
  });

  afterAll(() => {
    cleanTmpDir(isolatedCwd);
  });

  const cli = (args: string): { stdout: string; stderr: string } => {
    // totem-context: test helper — args are hardcoded test strings, not user input
    const result = spawnSync('node', [distEntry, ...args.split(' ')], {
      cwd: isolatedCwd,
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };

  it('registers review as a visible command in --help', () => {
    const { stdout } = cli('--help');
    expect(stdout).toContain('review');
  });

  it('does NOT show shield as a visible command in --help', () => {
    const { stdout } = cli('--help');
    // shield should be hidden — it must not appear as a top-level command line
    const lines = stdout.split('\n').filter((l) => /^\s+shield\s/.test(l));
    expect(lines).toHaveLength(0);
  });

  it('shield subcommand help describes it as deprecated alias', () => {
    const { stdout } = cli('shield --help');
    expect(stdout).toContain('Deprecated alias');
    expect(stdout).toContain('totem review');
  });

  it('shield alias emits deprecation warning to stderr when invoked', () => {
    // Running `shield` without proper git context will fail, but the
    // deprecation warning is emitted before the action logic runs.
    const { stderr } = cli('shield');
    expect(stderr).toContain("'totem shield' is deprecated");
    expect(stderr).toContain('totem review');
  });
});
