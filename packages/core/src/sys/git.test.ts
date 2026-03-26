import { execFileSync } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));

import {
  extractChangedFiles,
  filterDiffByPatterns,
  getGitLogSince,
  getLatestTag,
  getTagDate,
  isFileDirty,
} from './git.js';

describe('getLatestTag', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the latest tag', () => {
    vi.mocked(execFileSync).mockReturnValue('v0.14.0\n');
    expect(getLatestTag('/tmp')).toBe('v0.14.0');
  });

  it('returns null when no tags exist', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('fatal: no tags');
    });
    expect(getLatestTag('/tmp')).toBeNull();
  });

  it('returns null for empty output', () => {
    vi.mocked(execFileSync).mockReturnValue('\n');
    expect(getLatestTag('/tmp')).toBeNull();
  });
});

describe('getTagDate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns YYYY-MM-DD date for a valid tag', () => {
    vi.mocked(execFileSync).mockReturnValue('2026-03-01T12:00:00-05:00\n');
    expect(getTagDate('/tmp', 'v0.14.0')).toBe('2026-03-01');
  });

  it('returns null when tag does not exist', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('fatal: bad object');
    });
    expect(getTagDate('/tmp', 'v999.0.0')).toBeNull();
  });
});

describe('getGitLogSince', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns log since a tag', () => {
    vi.mocked(execFileSync).mockReturnValue('abc1234 feat: thing\ndef5678 fix: bug\n');
    const result = getGitLogSince('/tmp', 'v0.14.0');
    expect(result).toContain('abc1234');
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['log', 'v0.14.0..HEAD', '--oneline', '--max-count=50'],
      expect.any(Object),
    );
  });

  it('returns recent commits when no since ref provided', () => {
    vi.mocked(execFileSync).mockReturnValue('abc1234 feat: thing\n');
    getGitLogSince('/tmp');
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'git',
      ['log', '--oneline', '-50'],
      expect.any(Object),
    );
  });

  it('returns empty string on error', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a git repo');
    });
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
    vi.mocked(execFileSync).mockReturnValue(' M README.md\n');
    expect(isFileDirty('/tmp', 'README.md')).toBe(true);
  });

  it('returns false when file is clean', () => {
    vi.mocked(execFileSync).mockReturnValue('');
    expect(isFileDirty('/tmp', 'README.md')).toBe(false);
  });

  it('returns false on error', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(isFileDirty('/tmp', 'README.md')).toBe(false);
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
