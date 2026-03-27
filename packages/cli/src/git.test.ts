import { describe, expect, it, vi } from 'vitest';

import {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getDiffBetween,
  getDiffForReview,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffStat,
  getGitLogSince,
  getGitStatus,
  getLatestTag,
  getNameStatus,
  getShortstat,
  getTagDate,
  isAncestor,
  isFileDirty,
  resolveGitRoot,
} from './git.js';

describe('git re-exports', () => {
  it('re-exports all pure git utilities from core', () => {
    // Verify all re-exported functions are defined
    expect(typeof extractChangedFiles).toBe('function');
    expect(typeof filterDiffByPatterns).toBe('function');
    expect(typeof getDefaultBranch).toBe('function');
    expect(typeof getGitBranch).toBe('function');
    expect(typeof getGitBranchDiff).toBe('function');
    expect(typeof getGitDiff).toBe('function');
    expect(typeof getGitDiffStat).toBe('function');
    expect(typeof getGitLogSince).toBe('function');
    expect(typeof getGitStatus).toBe('function');
    expect(typeof getLatestTag).toBe('function');
    expect(typeof getTagDate).toBe('function');
    expect(typeof isFileDirty).toBe('function');
    expect(typeof resolveGitRoot).toBe('function');
  });

  it('still exports getDiffForReview locally', () => {
    expect(typeof getDiffForReview).toBe('function');
  });

  it('exports incremental shield helpers', () => {
    expect(typeof isAncestor).toBe('function');
    expect(typeof getShortstat).toBe('function');
    expect(typeof getNameStatus).toBe('function');
    expect(typeof getDiffBetween).toBe('function');
  });
});

// ─── Incremental shield git helpers (#1010) ─────────

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    safeExec: vi.fn(),
  };
});

// Must import after mock setup — vitest hoists vi.mock
const { safeExec } = await import('@mmnto/totem');
const mockSafeExec = vi.mocked(safeExec);

describe('isAncestor', () => {
  it('returns true for direct ancestor', () => {
    mockSafeExec.mockReturnValueOnce('');
    expect(isAncestor('/tmp', 'abc123')).toBe(true);
    expect(mockSafeExec).toHaveBeenCalledWith(
      'git',
      ['merge-base', '--is-ancestor', 'abc123', 'HEAD'],
      { cwd: '/tmp' },
    );
  });

  it('returns false for non-ancestor', () => {
    mockSafeExec.mockImplementationOnce(() => {
      throw new Error('exit code 1');
    });
    expect(isAncestor('/tmp', 'abc123')).toBe(false);
  });

  it('passes custom head ref when provided', () => {
    mockSafeExec.mockReturnValueOnce('');
    isAncestor('/tmp', 'abc123', 'def456');
    expect(mockSafeExec).toHaveBeenCalledWith(
      'git',
      ['merge-base', '--is-ancestor', 'abc123', 'def456'],
      { cwd: '/tmp' },
    );
  });
});

describe('getShortstat', () => {
  it('parses insertions only', () => {
    mockSafeExec.mockReturnValueOnce(' 1 file changed, 3 insertions(+)');
    const result = getShortstat('/tmp', 'abc123');
    expect(result).toEqual({ files: 1, insertions: 3, deletions: 0 });
  });

  it('parses insertions and deletions', () => {
    mockSafeExec.mockReturnValueOnce(' 2 files changed, 4 insertions(+), 2 deletions(-)');
    const result = getShortstat('/tmp', 'abc123');
    expect(result).toEqual({ files: 2, insertions: 4, deletions: 2 });
  });

  it('parses deletions only', () => {
    mockSafeExec.mockReturnValueOnce(' 1 file changed, 5 deletions(-)');
    const result = getShortstat('/tmp', 'abc123');
    expect(result).toEqual({ files: 1, insertions: 0, deletions: 5 });
  });

  it('returns zeros on error', () => {
    mockSafeExec.mockImplementationOnce(() => {
      throw new Error('git error');
    });
    expect(getShortstat('/tmp', 'abc123')).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });
});

describe('getNameStatus', () => {
  it('parses modified and added files', () => {
    mockSafeExec.mockReturnValueOnce('M\tsrc/foo.ts\nA\tsrc/bar.ts');
    const result = getNameStatus('/tmp', 'abc123');
    expect(result).toEqual([
      { status: 'M', file: 'src/foo.ts' },
      { status: 'A', file: 'src/bar.ts' },
    ]);
  });

  it('returns empty array on error', () => {
    mockSafeExec.mockImplementationOnce(() => {
      throw new Error('git error');
    });
    expect(getNameStatus('/tmp', 'abc123')).toEqual([]);
  });

  it('handles deleted files', () => {
    mockSafeExec.mockReturnValueOnce('D\tsrc/old.ts');
    const result = getNameStatus('/tmp', 'abc123');
    expect(result).toEqual([{ status: 'D', file: 'src/old.ts' }]);
  });
});

describe('getDiffBetween', () => {
  it('returns diff output between two refs', () => {
    mockSafeExec.mockReturnValueOnce('diff --git a/foo.ts b/foo.ts\n+const x = 1;');
    const result = getDiffBetween('/tmp', 'abc123');
    expect(result).toContain('+const x = 1;');
    expect(mockSafeExec).toHaveBeenCalledWith('git', ['diff', 'abc123', 'HEAD'], {
      cwd: '/tmp',
      maxBuffer: 10 * 1024 * 1024,
    });
  });

  it('returns empty string on error', () => {
    mockSafeExec.mockImplementationOnce(() => {
      throw new Error('git error');
    });
    expect(getDiffBetween('/tmp', 'abc123')).toBe('');
  });
});
