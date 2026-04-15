import * as path from 'node:path';

import * as crossSpawn from 'cross-spawn';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cross-spawn', () => ({
  sync: vi.fn(),
}));

import { fail, ok } from '../test-utils.js';
import {
  extractChangedFiles,
  filterDiffByPatterns,
  getGitLogSince,
  getLatestTag,
  getTagDate,
  inferScopeFromFiles,
  isFileDirty,
  resolveGitRoot,
} from './git.js';

describe('getLatestTag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the latest tag', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('v0.14.0\n') as never);
    expect(getLatestTag('/tmp')).toBe('v0.14.0');
  });

  it('returns null when no tags exist', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(fail(new Error('fatal: no tags')) as never);
    expect(getLatestTag('/tmp')).toBeNull();
  });

  it('returns null for empty output', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('\n') as never);
    expect(getLatestTag('/tmp')).toBeNull();
  });
});

describe('getTagDate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns YYYY-MM-DD date for a valid tag', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('2026-03-01T12:00:00-05:00\n') as never);
    expect(getTagDate('/tmp', 'v0.14.0')).toBe('2026-03-01');
  });

  it('returns null when tag does not exist', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(fail(new Error('fatal: bad object')) as never);
    expect(getTagDate('/tmp', 'v999.0.0')).toBeNull();
  });
});

describe('getGitLogSince', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns log since a tag', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(
      ok('abc1234 feat: thing\ndef5678 fix: bug\n') as never,
    );
    const result = getGitLogSince('/tmp', 'v0.14.0');
    expect(result).toContain('abc1234');
    expect(vi.mocked(crossSpawn.sync)).toHaveBeenCalledWith(
      'git',
      ['log', 'v0.14.0..HEAD', '--oneline', '--max-count=50'],
      expect.any(Object),
    );
  });

  it('returns recent commits when no since ref provided', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('abc1234 feat: thing\n') as never);
    getGitLogSince('/tmp');
    expect(vi.mocked(crossSpawn.sync)).toHaveBeenCalledWith(
      'git',
      ['log', '--oneline', '-50'],
      expect.any(Object),
    );
  });

  it('returns empty string on error', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(fail(new Error('not a git repo')) as never);
    expect(getGitLogSince('/tmp')).toBe('');
  });
});

describe('filterDiffByPatterns', () => {
  const DIFF_WITH_STRATEGY = [
    'diff --git a/.strategy b/.strategy',
    'index abc1234..def5678 160000',
    '--- a/.strategy',
    '+++ b/.strategy',
    '@@ -1 +1 @@',
    '-Subproject commit aaa',
    '+Subproject commit bbb',
  ].join('\n');

  const DIFF_WITH_CODE = [
    'diff --git a/packages/cli/src/commands/lint.ts b/packages/cli/src/commands/lint.ts',
    'index 1234567..abcdef0 100644',
    '--- a/packages/cli/src/commands/lint.ts',
    '+++ b/packages/cli/src/commands/lint.ts',
    '@@ -1,3 +1,4 @@',
    ' import { foo } from "bar";',
    '+const x = 1;',
  ].join('\n');

  it('removes sections matching ignore patterns', () => {
    const combined = DIFF_WITH_STRATEGY + '\n' + DIFF_WITH_CODE;
    const result = filterDiffByPatterns(combined, ['.strategy']);
    expect(result).not.toContain('.strategy');
    expect(result).toContain('lint.ts');
  });

  it('returns full diff when no patterns match', () => {
    const result = filterDiffByPatterns(DIFF_WITH_CODE, ['*.md']);
    expect(result).toContain('lint.ts');
  });

  it('returns full diff when patterns array is empty', () => {
    const combined = DIFF_WITH_STRATEGY + '\n' + DIFF_WITH_CODE;
    const result = filterDiffByPatterns(combined, []);
    expect(result).toContain('.strategy');
    expect(result).toContain('lint.ts');
  });

  it('returns empty string when all sections are filtered out', () => {
    const result = filterDiffByPatterns(DIFF_WITH_STRATEGY, ['.strategy']);
    expect(result.trim()).toBe('');
  });
});

describe('isFileDirty', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true when file has changes', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok(' M README.md\n') as never);
    expect(isFileDirty('/tmp', 'README.md')).toBe(true);
  });

  it('returns false when file is clean', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('') as never);
    expect(isFileDirty('/tmp', 'README.md')).toBe(false);
  });

  it('throws TotemGitError when git fails (mmnto/totem#1440 — no silent-false footgun)', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(fail(new Error('spawn failed')) as never);
    expect(() => isFileDirty('/tmp', 'README.md')).toThrow(/Failed to check dirty status/);
  });

  it('returns false when the cwd is not a git repository (narrow-false, mirrors resolveGitRoot)', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(
      fail(
        new Error('fatal: not a git repository (or any of the parent directories): .git'),
      ) as never,
    );
    expect(isFileDirty('/tmp', 'README.md')).toBe(false);
  });
});

describe('resolveGitRoot (mmnto/totem#1440)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the normalized repo root when git succeeds', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('/home/user/repo\n') as never);
    expect(resolveGitRoot('/home/user/repo/src')).toBe(path.normalize('/home/user/repo'));
  });

  it('returns null only when the error is the documented "not a git repository" case', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(
      fail(
        new Error('fatal: not a git repository (or any of the parent directories): .git'),
      ) as never,
    );
    expect(resolveGitRoot('/tmp')).toBeNull();
  });

  it('throws TotemGitError on other git failures (permission, corruption, timeout) — no silent-null footgun', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(
      fail(new Error('fatal: unable to access index: permission denied')) as never,
    );
    expect(() => resolveGitRoot('/tmp')).toThrow(/Failed to resolve git root/);
  });
});

describe('extractChangedFiles', () => {
  it('extracts file paths from unquoted diff headers', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '+++ b/src/foo.ts',
      'diff --git a/src/bar.ts b/src/bar.ts',
      '+++ b/src/bar.ts',
    ].join('\n');
    expect(extractChangedFiles(diff)).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('extracts file paths from quoted diff headers', () => {
    const diff = 'diff --git "a/my file.ts" "b/my file.ts"\n+++ "b/my file.ts"';
    expect(extractChangedFiles(diff)).toEqual(['my file.ts']);
  });

  it('returns empty array for empty diff', () => {
    expect(extractChangedFiles('')).toEqual([]);
  });
});

describe('inferScopeFromFiles', () => {
  it('returns common prefix glob for files in same directory', () => {
    const files = ['packages/cli/src/commands/foo.ts', 'packages/cli/src/commands/bar.ts'];
    expect(inferScopeFromFiles(files)).toEqual([
      'packages/cli/src/commands/**/*.ts',
      '!**/*.test.*',
      '!**/*.spec.*',
    ]);
  });

  it('uses dominant extension when files have mixed extensions', () => {
    const files = [
      'packages/core/src/util.ts',
      'packages/core/src/helper.ts',
      'packages/core/src/index.js',
    ];
    const result = inferScopeFromFiles(files);
    expect(result[0]).toBe('packages/core/src/**/*.ts');
    expect(result).toContain('!**/*.test.*');
    expect(result).toContain('!**/*.spec.*');
  });

  it('uses broad common prefix when files span multiple subdirectories', () => {
    const files = [
      'packages/cli/src/commands/extract.ts',
      'packages/core/src/sys/git.ts',
      'packages/mcp/src/server.ts',
    ];
    const result = inferScopeFromFiles(files);
    expect(result[0]).toBe('packages/**/*.ts');
  });

  it('returns empty array when files span root directories', () => {
    const files = ['src/foo.ts', 'lib/bar.ts'];
    expect(inferScopeFromFiles(files)).toEqual([]);
  });

  it('filters out non-code files (.md, .json, .yaml)', () => {
    const files = [
      'packages/core/src/index.ts',
      'packages/core/README.md',
      'packages/core/package.json',
      'packages/core/tsconfig.json',
      'packages/core/src/util.ts',
    ];
    const result = inferScopeFromFiles(files);
    expect(result[0]).toBe('packages/core/src/**/*.ts');
  });

  it('always includes test exclusions when returning a suggestion', () => {
    const files = ['src/commands/lint.ts'];
    const result = inferScopeFromFiles(files);
    expect(result).toHaveLength(3);
    expect(result[1]).toBe('!**/*.test.*');
    expect(result[2]).toBe('!**/*.spec.*');
  });

  it('returns empty array for empty input', () => {
    expect(inferScopeFromFiles([])).toEqual([]);
  });

  it('returns empty array when all files are non-code', () => {
    const files = ['README.md', 'package.json', '.eslintrc.yaml'];
    expect(inferScopeFromFiles(files)).toEqual([]);
  });

  it('does not confuse sibling directories with shared string prefix', () => {
    const files = ['packages/core/src/index.ts', 'packages/core-utils/src/index.ts'];
    // Common prefix should be "packages", not "packages/core"
    const result = inferScopeFromFiles(files);
    expect(result[0]).toBe('packages/**/*.ts');
  });
});
