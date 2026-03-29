import { execSync } from 'node:child_process';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Integration tests for the `review` command registration and
 * the deprecated `shield` alias. Uses the built CLI dist output.
 */
describe('review command alias', () => {
  const distEntry = path.resolve(process.cwd(), 'dist/index.js');

  const cli = (args: string): { stdout: string; stderr: string } => {
    try {
      // totem-context: test helper — args are hardcoded test strings, not user input
      const stdout = execSync(`node "${distEntry}" ${args}`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: 10_000,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });
      return { stdout, stderr: '' };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
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
