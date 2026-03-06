import * as childProcess from 'node:child_process';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getChangedFiles, getHeadSha } from './file-resolver.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getHeadSha', () => {
  it('returns trimmed SHA on success', () => {
    vi.mocked(childProcess.execSync).mockReturnValue('abc123def456\n');
    expect(getHeadSha('/project')).toBe('abc123def456');
  });

  it('returns null when git fails', () => {
    vi.mocked(childProcess.execSync).mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(getHeadSha('/project')).toBeNull();
  });

  it('calls onWarn when git fails', () => {
    vi.mocked(childProcess.execSync).mockImplementation(() => {
      throw new Error('not a git repo');
    });
    const warn = vi.fn();
    getHeadSha('/project', warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a git repo'));
  });
});

describe('getChangedFiles', () => {
  it('returns deduplicated paths from diff and untracked', () => {
    vi.mocked(childProcess.execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('git diff')) return 'src/a.ts\nsrc/b.ts\n';
      if (cmd.includes('ls-files')) return 'src/b.ts\nsrc/new.ts\n';
      return '';
    });
    const result = getChangedFiles('/project', 'HEAD~1');
    expect(result).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/new.ts']));
    expect(result).toHaveLength(3);
  });

  it('returns null and warns when git diff fails', () => {
    vi.mocked(childProcess.execSync).mockImplementation(() => {
      throw new Error('bad ref');
    });
    const warn = vi.fn();
    const result = getChangedFiles('/project', 'HEAD~1', warn);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad ref'));
  });

  it('still returns diff results when untracked listing fails', () => {
    let callCount = 0;
    vi.mocked(childProcess.execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('git diff')) return 'src/a.ts\n';
      // Second call (ls-files) throws
      callCount++;
      if (callCount >= 1) throw new Error('ls-files failed');
      return '';
    });
    const warn = vi.fn();
    const result = getChangedFiles('/project', 'HEAD~1', warn);
    expect(result).toEqual(['src/a.ts']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('untracked'));
  });

  it('normalizes backslashes to forward slashes', () => {
    vi.mocked(childProcess.execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('git diff')) return 'src\\foo\\bar.ts\n';
      return '';
    });
    const result = getChangedFiles('/project');
    expect(result).toEqual(['src/foo/bar.ts']);
  });
});
