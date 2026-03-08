import { execFileSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

import { getGitLogSince, getLatestTag, getTagDate, isFileDirty } from './git.js';

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
