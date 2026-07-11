import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getDiffBetween,
  getDiffForReview,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffRange,
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
    expect(typeof getGitDiffRange).toBe('function');
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
    getGitDiff: vi.fn(),
    getGitBranchDiff: vi.fn(),
    getGitBranchDiffResult: vi.fn(),
    getGitDiffRange: vi.fn(),
    getDefaultBranch: vi.fn(() => 'main'),
  };
});

// Mock the ui logger so the #2090/#2091 tests can assert on the exact
// disclosure / warning lines getDiffForReview emits.
vi.mock('./ui.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    dim: vi.fn(),
  },
}));

// Must import after mock setup — vitest hoists vi.mock.
// Aliased so the imports don't shadow the top-of-file re-export checks.
const totemMod = await import('@mmnto/totem');
const uiMod = await import('./ui.js');
const mockSafeExec = vi.mocked(totemMod.safeExec);
const mockGetGitDiff = vi.mocked(totemMod.getGitDiff);
const mockGetGitBranchDiff = vi.mocked(totemMod.getGitBranchDiff);
const mockGetGitBranchDiffResult = vi.mocked(totemMod.getGitBranchDiffResult);
const mockGetGitDiffRange = vi.mocked(totemMod.getGitDiffRange);
const mockGetDefaultBranch = vi.mocked(totemMod.getDefaultBranch);
const mockLog = vi.mocked(uiMod.log);

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

// ─── getDiffForReview --diff (#1717) ─────────────────

describe('getDiffForReview --diff (#1717)', () => {
  const config = { ignorePatterns: [] as string[] };
  const sampleDiff = 'diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n+x';

  beforeEach(() => {
    mockGetGitDiffRange.mockReset();
    mockGetGitDiff.mockReset();
    mockGetGitBranchDiff.mockReset();
    mockGetGitBranchDiffResult.mockReset();
  });

  it('uses the explicit-range path and reports source: explicit-range', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ diff: 'HEAD^..HEAD' }, config, '/tmp', 'Review');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('explicit-range');
    expect(mockGetGitDiffRange).toHaveBeenCalledWith('/tmp', 'HEAD^..HEAD');
  });

  it('skips the staged/working/branch fallback chain when --diff is set', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    await getDiffForReview({ diff: 'main...feature' }, config, '/tmp', 'Review');
    expect(mockGetGitDiffRange).toHaveBeenCalledTimes(1);
    expect(mockGetGitDiff).not.toHaveBeenCalled();
    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
    expect(mockGetGitBranchDiffResult).not.toHaveBeenCalled();
  });

  it('returns null when explicit range produces an empty diff', async () => {
    mockGetGitDiffRange.mockReturnValue('');
    const result = await getDiffForReview({ diff: 'HEAD..HEAD' }, config, '/tmp', 'Review');
    expect(result).toBeNull();
  });

  it('still applies ignore patterns to the explicit-range diff', async () => {
    const lockfileDiff = [
      'diff --git a/package-lock.json b/package-lock.json',
      '--- a/package-lock.json',
      '+++ b/package-lock.json',
      '@@ -1 +1 @@',
      '-{"v":1}',
      '+{"v":2}',
      '',
    ].join('\n');
    mockGetGitDiffRange.mockReturnValue(lockfileDiff);
    const result = await getDiffForReview(
      { diff: 'HEAD^..HEAD' },
      { ignorePatterns: ['package-lock.json'] },
      '/tmp',
      'Review',
    );
    expect(result).toBeNull();
  });

  it('reports source: branch-vs-base when the working-tree diff is empty', async () => {
    mockGetGitDiff.mockReturnValue('');
    mockGetGitBranchDiffResult.mockReturnValue({ diff: sampleDiff, resolvedBase: 'main' });
    const result = await getDiffForReview({}, config, '/tmp', 'Review');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('branch-vs-base');
  });

  it('reports source: staged when --staged is set and produces a diff', async () => {
    mockGetGitDiff.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ staged: true }, config, '/tmp', 'Review');
    expect(result).not.toBeNull();
    expect(result!.source).toBe('staged');
    expect(mockGetGitDiff).toHaveBeenCalledWith('staged', '/tmp');
  });
});

// ─── getDiffForReview --branch/--base (#2091) ────────────

/** Build a minimal unified diff touching the given files. */
function diffFor(...files: string[]): string {
  const lines = files.flatMap((f) => [
    `diff --git a/${f} b/${f}`,
    `--- a/${f}`,
    `+++ b/${f}`,
    '@@ -1 +1 @@',
    '+x',
  ]);
  return `${lines.join('\n')}\n`;
}

describe('getDiffForReview --branch/--base (#2091)', () => {
  const config = { ignorePatterns: [] as string[] };

  beforeEach(() => {
    mockGetGitDiffRange.mockReset();
    mockGetGitDiff.mockReset();
    mockGetGitBranchDiff.mockReset();
    mockGetGitBranchDiffResult.mockReset();
    mockGetDefaultBranch.mockClear();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
  });

  it('--base forces branch scope even with a dirty working tree', async () => {
    // Dirty tree: getGitDiff WOULD return uncommitted content — the forced
    // path must never consult it, so none of it can enter the diff.
    mockGetGitDiff.mockReturnValue(diffFor('dirty.ts'));
    mockGetGitBranchDiffResult.mockReturnValue({
      diff: diffFor('committed.ts'),
      resolvedBase: 'develop',
    });

    const result = await getDiffForReview({ base: 'develop' }, config, '/tmp', 'Lint');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('branch-vs-base');
    expect(result!.changedFiles).toEqual(['committed.ts']);
    expect(mockGetGitDiff).not.toHaveBeenCalled();
    expect(mockGetGitBranchDiffResult).toHaveBeenCalledWith('/tmp', 'develop');
  });

  it('--branch resolves the default branch and reports source: branch-vs-base', async () => {
    mockGetGitBranchDiffResult.mockReturnValue({ diff: diffFor('a.ts'), resolvedBase: 'main' });

    const result = await getDiffForReview({ branch: true }, config, '/tmp', 'Lint');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('branch-vs-base');
    expect(mockGetGitBranchDiffResult).toHaveBeenCalledWith('/tmp', 'main');
    expect(mockGetGitDiff).not.toHaveBeenCalled();
  });

  it('logs the forced diff-source disclosure line marking the forcing flag', async () => {
    mockGetGitBranchDiffResult.mockReturnValue({ diff: diffFor('a.ts'), resolvedBase: 'main' });

    await getDiffForReview({ branch: true }, config, '/tmp', 'Lint');

    const disclosure = mockLog.info.mock.calls.find((c) => String(c[1]).startsWith('Diff source:'));
    expect(disclosure).toBeDefined();
    expect(disclosure![1]).toBe(
      'Diff source: branch-vs-base (--branch; origin/main...HEAD, else local main)',
    );
  });

  it('discloses only --base when --branch was not passed (Greptile on #2098)', async () => {
    mockGetGitBranchDiffResult.mockReturnValue({ diff: diffFor('a.ts'), resolvedBase: 'develop' });

    await getDiffForReview({ base: 'develop' }, config, '/tmp', 'Lint');

    const disclosure = mockLog.info.mock.calls.find((c) => String(c[1]).startsWith('Diff source:'));
    expect(disclosure).toBeDefined();
    expect(disclosure![1]).toBe(
      'Diff source: branch-vs-base (--base; origin/develop...HEAD, else local develop)',
    );
  });

  it('--branch + --staged throws FLAG_CONFLICT before any git function is invoked', async () => {
    await expect(
      getDiffForReview({ branch: true, staged: true }, config, '/tmp', 'Lint'),
    ).rejects.toMatchObject({ code: 'FLAG_CONFLICT' });

    expect(mockGetGitDiff).not.toHaveBeenCalled();
    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
    expect(mockGetGitDiffRange).not.toHaveBeenCalled();
    expect(mockGetDefaultBranch).not.toHaveBeenCalled();
  });

  it('--branch + --diff throws a conflict error naming both flags before any git work', async () => {
    await expect(
      getDiffForReview({ branch: true, diff: 'HEAD^..HEAD' }, config, '/tmp', 'Lint'),
    ).rejects.toThrow(/--branch.*--diff/);

    expect(mockGetGitDiff).not.toHaveBeenCalled();
    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
    expect(mockGetGitDiffRange).not.toHaveBeenCalled();
    expect(mockGetDefaultBranch).not.toHaveBeenCalled();
  });

  it('--base + --staged throws a conflict error (base implies branch scope)', async () => {
    await expect(
      getDiffForReview({ base: 'main', staged: true }, config, '/tmp', 'Lint'),
    ).rejects.toThrow(/--base.*--staged/);

    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
  });

  it('--base + --diff throws a conflict error before any git work (Greptile on #2098)', async () => {
    await expect(
      getDiffForReview({ base: 'main', diff: 'HEAD^..HEAD' }, config, '/tmp', 'Lint'),
    ).rejects.toThrow(/--base.*--diff/);

    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
    expect(mockGetGitDiffRange).not.toHaveBeenCalled();
    expect(mockGetDefaultBranch).not.toHaveBeenCalled();
  });

  it('rejects a --base value with a leading dash (flag-injection guard)', async () => {
    await expect(getDiffForReview({ base: '--no-index' }, config, '/tmp', 'Lint')).rejects.toThrow(
      /git-flag injection/,
    );

    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
  });

  it('rejects an empty/whitespace --base value', async () => {
    await expect(getDiffForReview({ base: '   ' }, config, '/tmp', 'Lint')).rejects.toThrow(
      /Empty base branch/,
    );

    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
  });

  it('returns null with the existing no-changes warn when the forced branch diff is empty', async () => {
    mockGetGitBranchDiffResult.mockReturnValue({ diff: '', resolvedBase: 'main' });

    const result = await getDiffForReview({ branch: true }, config, '/tmp', 'Lint');

    expect(result).toBeNull();
    const warned = mockLog.warn.mock.calls.find((c) =>
      String(c[1]).includes('No changes detected'),
    );
    expect(warned).toBeDefined();
  });

  it('lets branch-diff errors bubble on the forced path', async () => {
    mockGetGitBranchDiffResult.mockImplementation(() => {
      // totem-context: throw inside a vitest mock to prove the forced path does NOT swallow branch-diff failures (the TotemGitError carries the actionable fetch hint); sentinel message is test-only
      throw new Error('fatal: bad revision');
    });

    await expect(getDiffForReview({ branch: true }, config, '/tmp', 'Lint')).rejects.toThrow(
      /bad revision/,
    );
  });
});

// ─── getDiffForReview scope metadata (Prop 304 R2) ───────

describe('getDiffForReview scope metadata (Prop 304)', () => {
  const config = { ignorePatterns: [] as string[] };
  const sampleDiff = 'diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n+x';

  beforeEach(() => {
    mockGetGitDiffRange.mockReset();
    mockGetGitDiff.mockReset();
    mockGetGitBranchDiff.mockReset();
    mockGetGitBranchDiffResult.mockReset();
    mockSafeExec.mockReset();
    mockGetDefaultBranch.mockClear();
  });

  it('explicit two-dot range resolves both base and head endpoints', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ diff: 'HEAD^..HEAD' }, config, '/tmp', 'Review');
    expect(result!.source).toBe('explicit-range');
    expect(result!.base).toBe('HEAD^');
    expect(result!.head).toBe('HEAD');
  });

  it('explicit three-dot range resolves both endpoints', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ diff: 'main...feature' }, config, '/tmp', 'Review');
    expect(result!.base).toBe('main');
    expect(result!.head).toBe('feature');
  });

  it('explicit range with an omitted head side defaults head to HEAD', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ diff: 'main..' }, config, '/tmp', 'Review');
    expect(result!.base).toBe('main');
    expect(result!.head).toBe('HEAD');
  });

  it('bare explicit ref resolves base only (working-tree head is unnamed)', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ diff: 'HEAD' }, config, '/tmp', 'Review');
    expect(result!.base).toBe('HEAD');
    expect(result!.head).toBeUndefined();
  });

  it('forced --base records the resolvedBase the diff operation returned — local fallback (rev-5 item 3)', async () => {
    // The diff operation itself reports which ref produced the payload: here the
    // remote-exists-but-diff-fails (or remote-absent) case fell back to local `develop`.
    mockGetGitBranchDiffResult.mockReturnValue({ diff: sampleDiff, resolvedBase: 'develop' });
    const result = await getDiffForReview({ base: 'develop' }, config, '/tmp', 'Review');
    expect(result!.source).toBe('branch-vs-base');
    expect(result!.base).toBe('develop');
    expect(result!.head).toBeUndefined();
  });

  it('forced --base records origin/<base> when the REMOTE diff produced the payload (finding 7 — divergent local/remote)', async () => {
    mockGetGitBranchDiffResult.mockReturnValue({
      diff: sampleDiff,
      resolvedBase: 'origin/develop',
    });
    const result = await getDiffForReview({ base: 'develop' }, config, '/tmp', 'Review');
    expect(result!.source).toBe('branch-vs-base');
    expect(result!.base).toBe('origin/develop');
  });

  it('--branch resolves the default branch as base with no head', async () => {
    mockGetGitBranchDiffResult.mockReturnValue({ diff: sampleDiff, resolvedBase: 'main' });
    const result = await getDiffForReview({ branch: true }, config, '/tmp', 'Review');
    expect(result!.base).toBe('main');
    expect(result!.head).toBeUndefined();
  });

  it('auto-fallback branch-vs-base records the default base, no head', async () => {
    mockGetGitDiff.mockReturnValue('');
    mockGetGitBranchDiffResult.mockReturnValue({ diff: sampleDiff, resolvedBase: 'main' });
    const result = await getDiffForReview({}, config, '/tmp', 'Review');
    expect(result!.source).toBe('branch-vs-base');
    expect(result!.base).toBe('main');
    expect(result!.head).toBeUndefined();
  });

  it('staged scope carries neither base nor head', async () => {
    mockGetGitDiff.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({ staged: true }, config, '/tmp', 'Review');
    expect(result!.source).toBe('staged');
    expect(result!.base).toBeUndefined();
    expect(result!.head).toBeUndefined();
  });

  it('uncommitted scope carries neither base nor head', async () => {
    mockGetGitDiff.mockReturnValue(sampleDiff);
    const result = await getDiffForReview({}, config, '/tmp', 'Review');
    expect(result!.source).toBe('uncommitted');
    expect(result!.base).toBeUndefined();
    expect(result!.head).toBeUndefined();
  });

  it('explicit-range captures the raw selectorForm; other sources omit it (finding 10)', async () => {
    mockGetGitDiffRange.mockReturnValue(sampleDiff);
    const bare = await getDiffForReview({ diff: 'main' }, config, '/tmp', 'Review');
    expect(bare!.selectorForm).toBe('main');
    const range = await getDiffForReview({ diff: 'main..HEAD' }, config, '/tmp', 'Review');
    expect(range!.selectorForm).toBe('main..HEAD');
    // A non-explicit source carries no selectorForm.
    mockGetGitDiff.mockReturnValue(sampleDiff);
    const staged = await getDiffForReview({ staged: true }, config, '/tmp', 'Review');
    expect(staged!.selectorForm).toBeUndefined();
  });
});

// ─── getDiffForReview narrow-scope warning (#2090) ───────

describe('getDiffForReview narrow-scope warning (#2090)', () => {
  const config = { ignorePatterns: [] as string[] };
  const NARROW_SCOPE_RE = /pre-push gate checks the full branch/;

  function findNarrowScopeWarning() {
    return mockLog.warn.mock.calls.find((c) => NARROW_SCOPE_RE.test(String(c[1])));
  }

  beforeEach(() => {
    mockGetGitDiffRange.mockReset();
    mockGetGitDiff.mockReset();
    mockGetGitBranchDiff.mockReset();
    mockGetGitBranchDiffResult.mockReset();
    mockGetDefaultBranch.mockClear();
    mockLog.info.mockClear();
    mockLog.warn.mockClear();
  });

  it('warns with the set difference — overlap files are not double-counted', async () => {
    mockGetGitDiff.mockReturnValue(diffFor('A.ts', 'B.ts'));
    mockGetGitBranchDiff.mockReturnValue(diffFor('B.ts', 'C.ts', 'D.ts'));

    const result = await getDiffForReview({ warnNarrowScope: true }, config, '/tmp', 'Lint');

    expect(result).not.toBeNull();
    expect(result!.source).toBe('uncommitted');
    const warning = findNarrowScopeWarning();
    expect(warning).toBeDefined();
    // B.ts overlaps both scopes — N must be 2 (C.ts, D.ts), not 3.
    expect(warning![1]).toBe(
      'Linting uncommitted changes only — the pre-push gate checks the full branch (2 more file(s)). Lint a clean tree or use `totem lint --branch` to match.',
    );
  });

  it('computes N from the post-ignore-filter branch diff (ignored files excluded)', async () => {
    const cfgWithIgnores = { ignorePatterns: ['package-lock.json'] };
    mockGetGitDiff.mockReturnValue(diffFor('A.ts'));
    mockGetGitBranchDiff.mockReturnValue(diffFor('B.ts', 'package-lock.json'));

    await getDiffForReview({ warnNarrowScope: true }, cfgWithIgnores, '/tmp', 'Lint');

    const warning = findNarrowScopeWarning();
    expect(warning).toBeDefined();
    // Raw --name-only would say 2; the gate-honest post-filter count is 1.
    expect(warning![1]).toContain('(1 more file(s))');
  });

  it('staged-mode warning opens with "Linting staged changes only"', async () => {
    mockGetGitDiff.mockReturnValue(diffFor('A.ts'));
    mockGetGitBranchDiff.mockReturnValue(diffFor('A.ts', 'B.ts'));

    const result = await getDiffForReview(
      { staged: true, warnNarrowScope: true },
      config,
      '/tmp',
      'Lint',
    );

    expect(result!.source).toBe('staged');
    const warning = findNarrowScopeWarning();
    expect(warning).toBeDefined();
    expect(String(warning![1]).startsWith('Linting staged changes only —')).toBe(true);
  });

  it('does not warn when the set difference is empty', async () => {
    mockGetGitDiff.mockReturnValue(diffFor('A.ts', 'B.ts'));
    mockGetGitBranchDiff.mockReturnValue(diffFor('A.ts'));

    await getDiffForReview({ warnNarrowScope: true }, config, '/tmp', 'Lint');

    expect(findNarrowScopeWarning()).toBeUndefined();
  });

  it('does not warn when the source resolves to branch-vs-base (auto-fallback)', async () => {
    mockGetGitDiff.mockReturnValue('');
    mockGetGitBranchDiffResult.mockReturnValue({ diff: diffFor('A.ts'), resolvedBase: 'main' });

    const result = await getDiffForReview({ warnNarrowScope: true }, config, '/tmp', 'Lint');

    expect(result!.source).toBe('branch-vs-base');
    expect(findNarrowScopeWarning()).toBeUndefined();
    // Branch diff was computed once for the scope itself — never a second
    // time for the warning (the advisory's separate getGitBranchDiff was never consulted).
    expect(mockGetGitBranchDiffResult).toHaveBeenCalledTimes(1);
    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
  });

  it('does not warn when the source is explicit-range', async () => {
    mockGetGitDiffRange.mockReturnValue(diffFor('A.ts'));

    const result = await getDiffForReview(
      { diff: 'HEAD^..HEAD', warnNarrowScope: true },
      config,
      '/tmp',
      'Lint',
    );

    expect(result!.source).toBe('explicit-range');
    expect(findNarrowScopeWarning()).toBeUndefined();
    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
  });

  it('does no branch-diff work and never warns when warnNarrowScope is unset (review path)', async () => {
    mockGetGitDiff.mockReturnValue(diffFor('A.ts'));

    await getDiffForReview({}, config, '/tmp', 'Review');

    expect(findNarrowScopeWarning()).toBeUndefined();
    expect(mockGetGitBranchDiff).not.toHaveBeenCalled();
  });

  it('a throw inside the warning computation leaves the result identical to the no-warning case', async () => {
    mockGetGitDiff.mockReturnValue(diffFor('A.ts'));
    mockGetGitBranchDiff.mockImplementation(() => {
      // totem-context: throw inside a vitest mock simulating a git failure (detached HEAD / no base) to prove the advisory is non-fatal per the Tenet-4 silent-skip row; sentinel message is test-only
      throw new Error('fatal: no merge base');
    });

    const withFailure = await getDiffForReview({ warnNarrowScope: true }, config, '/tmp', 'Lint');

    mockGetGitBranchDiff.mockReset();
    mockLog.warn.mockClear();
    const baseline = await getDiffForReview({}, config, '/tmp', 'Lint');

    expect(withFailure).toEqual(baseline);
    expect(withFailure!.source).toBe('uncommitted');
    expect(findNarrowScopeWarning()).toBeUndefined();
  });
});
