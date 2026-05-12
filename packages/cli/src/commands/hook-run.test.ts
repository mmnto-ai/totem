import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeHookRun, resolveInstalledPackVersions } from './hook-run.js';

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-run-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function writeManifest(content: unknown): string {
  const manifestPath = path.join(workDir, 'compiled-hooks.json');
  fs.writeFileSync(manifestPath, JSON.stringify(content), 'utf8');
  return manifestPath;
}

const baseRule = {
  id: 'gca-tag-xor-command',
  packId: '@mmnto/pack-bot-gemini-code-assist',
  trigger: { tool: 'bash', pattern: 'gh\\s+(pr|issue)\\s+comment' },
  check: {
    pattern: '(?=.*@gemini-code-assist)(?=.*\\/gemini review)',
    type: 'reject-if-match' as const,
  },
  message: 'GCA tag XOR command — never both; doubling wastes GCA quota.',
  recoveryHint: 'Choose one: @-mention to comment, /gemini review for fresh review.',
};

function baseManifest(hooks: unknown[] = [baseRule]): unknown {
  return {
    schemaVersion: 1,
    compiledAt: '2026-05-11T18:43:00Z',
    sourcePackVersions: {
      '@mmnto/pack-bot-gemini-code-assist': '1.0.0',
    },
    hooks,
  };
}

describe('executeHookRun — allow path', () => {
  it('returns exit 0 with no stderr when the manifest file is absent (fresh repo)', () => {
    const result = executeHookRun({
      manifestPath: path.join(workDir, 'missing.json'),
      installedPackVersions: {},
      payload: { tool: 'bash', args: 'whatever' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
  });

  it('returns exit 0 when no hook trigger matches the payload', () => {
    const manifestPath = writeManifest(baseManifest());
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
      payload: { tool: 'write', args: 'console.log("hi")' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
  });

  it('returns exit 0 when the trigger matches but the check does not (reject-if-match)', () => {
    const manifestPath = writeManifest(baseManifest());
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
      payload: {
        tool: 'bash',
        args: 'gh pr comment 1 --body "@gemini-code-assist take a look"',
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toEqual([]);
  });
});

describe('executeHookRun — reject path (ADR-104 § Decision 1)', () => {
  it('exits 2 with the structured [totem:hook-block] line on the first matching hook', () => {
    const manifestPath = writeManifest(baseManifest());
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
      payload: {
        tool: 'bash',
        args: 'gh pr comment 1 --body "@gemini-code-assist /gemini review please"',
      },
    });
    expect(result.exitCode).toBe(2);
    const rejectLine = result.stderr[result.stderr.length - 1]!;
    expect(rejectLine).toContain('[totem:hook-block]');
    expect(rejectLine).toContain('@mmnto/pack-bot-gemini-code-assist/gca-tag-xor-command');
    expect(rejectLine).toContain('GCA tag XOR command');
    expect(rejectLine).toContain('→ Choose one');
  });

  it('first-match-wins: a later hook that also matches is not evaluated', () => {
    const second = {
      ...baseRule,
      id: 'never-reached',
      message: 'should not appear in stderr',
    };
    const manifestPath = writeManifest(baseManifest([baseRule, second]));
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
      payload: {
        tool: 'bash',
        args: 'gh pr comment 1 --body "@gemini-code-assist /gemini review"',
      },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.some((l) => l.includes('never-reached'))).toBe(false);
    expect(result.stderr.some((l) => l.includes('should not appear'))).toBe(false);
  });

  it('omits the recoveryHint line when the rule has no recoveryHint', () => {
    const ruleWithoutHint = { ...baseRule, recoveryHint: undefined };
    const manifestPath = writeManifest(baseManifest([ruleWithoutHint]));
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
      payload: {
        tool: 'bash',
        args: 'gh pr comment 1 --body "@gemini-code-assist /gemini review"',
      },
    });
    expect(result.exitCode).toBe(2);
    const rejectLine = result.stderr[result.stderr.length - 1]!;
    expect(rejectLine).not.toContain('→');
  });
});

describe('executeHookRun — diagnostics ordering', () => {
  it('emits [totem:hook-stale] warnings before evaluating hooks (operator sees context for any rejection)', () => {
    const manifestPath = writeManifest(baseManifest());
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.1.0' },
      payload: {
        tool: 'bash',
        args: 'gh pr comment 1 --body "@gemini-code-assist /gemini review"',
      },
    });
    expect(result.exitCode).toBe(2);
    const staleIdx = result.stderr.findIndex((l) => l.includes('[totem:hook-stale]'));
    const rejectIdx = result.stderr.findIndex((l) => l.includes('[totem:hook-block]'));
    expect(staleIdx).toBeGreaterThanOrEqual(0);
    expect(rejectIdx).toBeGreaterThan(staleIdx);
  });

  it('emits [totem:hook-schema] warning and returns allow when manifest schemaVersion is unsupported', () => {
    const manifestPath = writeManifest({ ...(baseManifest() as object), schemaVersion: 999 });
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: {},
      payload: { tool: 'bash', args: 'whatever' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.some((l) => l.includes('[totem:hook-schema]'))).toBe(true);
  });

  it('emits [totem:hook-error] prefix on structural manifest errors (corrupt JSON)', () => {
    const manifestPath = path.join(workDir, 'compiled-hooks.json');
    fs.writeFileSync(manifestPath, '{ not valid json', 'utf8');
    const result = executeHookRun({
      manifestPath,
      installedPackVersions: {},
      payload: { tool: 'bash', args: 'whatever' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.some((l) => l.startsWith('[totem:hook-error]'))).toBe(true);
  });
});

describe('resolveInstalledPackVersions', () => {
  it('returns an empty map when no @mmnto scope directory exists', () => {
    const result = resolveInstalledPackVersions(workDir);
    expect(result).toEqual({});
  });

  it('reads version from each @mmnto/pack-* package.json under node_modules', () => {
    const scopeDir = path.join(workDir, 'node_modules', '@mmnto');
    const packDir = path.join(scopeDir, 'pack-bot-coderabbit');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'package.json'),
      JSON.stringify({ name: '@mmnto/pack-bot-coderabbit', version: '1.2.3' }),
      'utf8',
    );

    const result = resolveInstalledPackVersions(workDir);
    expect(result).toEqual({ '@mmnto/pack-bot-coderabbit': '1.2.3' });
  });

  it('skips non-pack-* @mmnto packages (e.g. @mmnto/totem itself)', () => {
    const scopeDir = path.join(workDir, 'node_modules', '@mmnto');
    const corePkg = path.join(scopeDir, 'totem');
    fs.mkdirSync(corePkg, { recursive: true });
    fs.writeFileSync(
      path.join(corePkg, 'package.json'),
      JSON.stringify({ name: '@mmnto/totem', version: '1.36.0' }),
      'utf8',
    );

    const result = resolveInstalledPackVersions(workDir);
    expect(result).toEqual({});
  });

  it('reads from symlinked pack directories (pnpm/yarn workspaces case)', () => {
    // Regression: Dirent.isDirectory() returns false for symlinks even when
    // the target is a directory. Workspace setups symlink packs into
    // `node_modules/@mmnto/`, so a pre-filter on `entry.isDirectory()` would
    // have silently skipped every workspace-linked pack. The function now
    // drops the type pre-filter and lets the `readFileSync` traversal +
    // try/catch handle it.
    const scopeDir = path.join(workDir, 'node_modules', '@mmnto');
    fs.mkdirSync(scopeDir, { recursive: true });

    // Target directory (the "source" of the pack).
    const sourceDir = path.join(workDir, 'workspace-pack-source');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(
      path.join(sourceDir, 'package.json'),
      JSON.stringify({ name: '@mmnto/pack-workspace', version: '2.0.0' }),
      'utf8',
    );

    // Symlink it into node_modules/@mmnto/pack-workspace. Skip the test on
    // platforms that do not grant the calling process permission to create
    // directory symlinks (Windows without developer mode / admin).
    try {
      fs.symlinkSync(sourceDir, path.join(scopeDir, 'pack-workspace'), 'dir');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }

    const result = resolveInstalledPackVersions(workDir);
    expect(result).toEqual({ '@mmnto/pack-workspace': '2.0.0' });
  });

  it('skips directory entries with unreadable or malformed package.json without failing the whole scan', () => {
    const scopeDir = path.join(workDir, 'node_modules', '@mmnto');
    const broken = path.join(scopeDir, 'pack-broken');
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, 'package.json'), '{ not json', 'utf8');

    const good = path.join(scopeDir, 'pack-good');
    fs.mkdirSync(good, { recursive: true });
    fs.writeFileSync(
      path.join(good, 'package.json'),
      JSON.stringify({ name: '@mmnto/pack-good', version: '1.0.0' }),
      'utf8',
    );

    const result = resolveInstalledPackVersions(workDir);
    expect(result).toEqual({ '@mmnto/pack-good': '1.0.0' });
  });
});
