import * as childProcess from 'node:child_process';

import { globSync } from 'glob';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getChangedFiles, getHeadSha, resolveFiles } from './file-resolver.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('glob', () => ({
  globSync: vi.fn(() => []),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getHeadSha', () => {
  it('returns trimmed SHA on success', () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue('abc123def456\n');
    expect(getHeadSha('/project')).toBe('abc123def456');
  });

  it('returns null when git fails', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(getHeadSha('/project')).toBeNull();
  });

  it('calls onWarn when git fails', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('not a git repo');
    });
    const warn = vi.fn();
    getHeadSha('/project', warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a git repo'));
  });
});

describe('getChangedFiles', () => {
  it('returns deduplicated paths from diff and untracked (null-delimited)', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(
      (_cmd: string, args?: readonly string[]) => {
        if (args && args.includes('diff')) return 'src/a.ts\0src/b.ts\0';
        if (args && args.includes('ls-files')) return 'src/b.ts\0src/new.ts\0';
        return '';
      },
    );
    const result = getChangedFiles('/project', 'HEAD~1');
    expect(result).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/new.ts']));
    expect(result).toHaveLength(3);
  });

  it('returns null and warns when git diff fails', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(() => {
      throw new Error('bad ref');
    });
    const warn = vi.fn();
    const result = getChangedFiles('/project', 'HEAD~1', warn);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bad ref'));
  });

  it('still returns diff results when untracked listing fails', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(
      (_cmd: string, args?: readonly string[]) => {
        if (args && args.includes('diff')) return 'src/a.ts\0';
        throw new Error('ls-files failed');
      },
    );
    const warn = vi.fn();
    const result = getChangedFiles('/project', 'HEAD~1', warn);
    expect(result).toEqual(['src/a.ts']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('untracked'));
  });

  it('normalizes backslashes to forward slashes', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(
      (_cmd: string, args?: readonly string[]) => {
        if (args && args.includes('diff')) return 'src\\foo\\bar.ts\0';
        return '';
      },
    );
    const result = getChangedFiles('/project');
    expect(result).toEqual(['src/foo/bar.ts']);
  });

  it('rejects sinceRef with shell metacharacters', () => {
    const warn = vi.fn();
    const result = getChangedFiles('/project', 'HEAD; rm -rf /', warn);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid git ref'));
  });

  it('accepts valid hex SHA as sinceRef', () => {
    vi.mocked(childProcess.execFileSync).mockReturnValue('');
    const result = getChangedFiles('/project', 'abc123def456');
    expect(result).toEqual([]);
  });
});

describe('resolveFiles — submodule support', () => {
  it('includes submodule files from --recurse-submodules call', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(
      (_cmd: string, args?: readonly string[]) => {
        if (args && args.includes('--recurse-submodules')) {
          return 'src/a.ts\0.strategy/north-star.md\0';
        }
        // Parent repo ls-files: does NOT include submodule files
        return 'src/a.ts\0';
      },
    );
    vi.mocked(globSync).mockReturnValue(['.strategy/north-star.md'] as unknown as string[] & {
      [Symbol.iterator]: () => IterableIterator<string>;
    });

    const result = resolveFiles(
      [{ glob: '.strategy/**/*.md', type: 'spec', strategy: 'markdown-heading' }],
      '/project',
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe('.strategy/north-star.md');
  });

  it('excludes submodule files not matched by glob', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(
      (_cmd: string, args?: readonly string[]) => {
        if (args && args.includes('--recurse-submodules')) {
          return '.strategy/north-star.md\0.strategy/archive/old.md\0';
        }
        return '';
      },
    );
    // Glob only matches the non-archived file (archive excluded via ignorePatterns)
    vi.mocked(globSync).mockReturnValue(['.strategy/north-star.md'] as unknown as string[] & {
      [Symbol.iterator]: () => IterableIterator<string>;
    });

    const result = resolveFiles(
      [{ glob: '.strategy/**/*.md', type: 'spec', strategy: 'markdown-heading' }],
      '/project',
      ['.strategy/archive/**'],
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe('.strategy/north-star.md');
  });

  it('works when --recurse-submodules is unsupported', () => {
    vi.mocked(childProcess.execFileSync).mockImplementation(
      (_cmd: string, args?: readonly string[]) => {
        if (args && args.includes('--recurse-submodules')) {
          throw new Error('unknown option');
        }
        return 'src/a.ts\0';
      },
    );
    vi.mocked(globSync).mockReturnValue(['src/a.ts'] as unknown as string[] & {
      [Symbol.iterator]: () => IterableIterator<string>;
    });

    const result = resolveFiles(
      [{ glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' }],
      '/project',
    );
    expect(result).toHaveLength(1);
    expect(result[0].relativePath).toBe('src/a.ts');
  });
});
