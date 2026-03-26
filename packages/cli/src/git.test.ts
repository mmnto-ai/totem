import { describe, expect, it } from 'vitest';

import {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getDiffForReview,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffStat,
  getGitLogSince,
  getGitStatus,
  getLatestTag,
  getTagDate,
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
});
