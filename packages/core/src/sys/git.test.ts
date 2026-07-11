import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as crossSpawn from 'cross-spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cross-spawn', () => ({
  sync: vi.fn(),
}));

import { TotemGitError } from '../errors.js';
import { fail, ok } from '../test-utils.js';
import {
  extractChangedFiles,
  filterDiffByPatterns,
  findRepoRootSync,
  findTotemRepoRootSync,
  getGitBranchDiff,
  getGitBranchDiffResult,
  getGitDiffRange,
  getGitLogSince,
  getLatestTag,
  getTagDate,
  inferScopeFromFiles,
  isFileDirty,
  resolveGitRoot,
  resolveTotemRepoRootSync,
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

describe('getGitDiffRange (#1717)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns diff output for a valid ref range', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(
      ok('diff --git a/foo.ts b/foo.ts\n+const x = 1;\n') as never,
    );
    const result = getGitDiffRange('/tmp', 'HEAD^..HEAD');
    expect(result).toContain('+const x = 1;');
    expect(vi.mocked(crossSpawn.sync)).toHaveBeenCalledWith(
      'git',
      ['diff', 'HEAD^..HEAD'],
      expect.any(Object),
    );
  });

  it('trims whitespace before invoking git', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(ok('') as never);
    getGitDiffRange('/tmp', '  main...feature  ');
    expect(vi.mocked(crossSpawn.sync)).toHaveBeenCalledWith(
      'git',
      ['diff', 'main...feature'],
      expect.any(Object),
    );
  });

  it('rejects empty ranges before invoking git', () => {
    expect(() => getGitDiffRange('/tmp', '')).toThrow(/Empty ref range/);
    expect(() => getGitDiffRange('/tmp', '   ')).toThrow(/Empty ref range/);
    expect(vi.mocked(crossSpawn.sync)).not.toHaveBeenCalled();
  });

  it('rejects ranges starting with a dash to defuse git-flag injection', () => {
    expect(() => getGitDiffRange('/tmp', '--no-index')).toThrow(/may not start with '-'/);
    expect(() => getGitDiffRange('/tmp', '-p')).toThrow(/may not start with '-'/);
    expect(vi.mocked(crossSpawn.sync)).not.toHaveBeenCalled();
  });

  it('wraps git failures in a TotemGitError with actionable hint', () => {
    vi.mocked(crossSpawn.sync).mockReturnValue(
      fail(new Error("fatal: bad revision 'nope..nope'")) as never,
    );
    expect(() => getGitDiffRange('/tmp', 'nope..nope')).toThrow(
      /Failed to compute diff for range 'nope..nope'/,
    );
  });
});

describe('getGitBranchDiff base-ref resolution (#2054)', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * Route the cross-spawn mock by which ref a `git diff <ref>...HEAD` call
   * names, so tests assert *which ref wins* independent of call order (the
   * exact thing #2054 changes). Keyed by bare ref (`main`, `origin/main`).
   */
  function routeDiffByRef(routes: Record<string, { ok?: string; fail?: string }>): void {
    vi.mocked(crossSpawn.sync).mockImplementation((_command, args) => {
      const range = (args ?? [])[1] ?? ''; // args === ['diff', '<ref>...HEAD']
      const outcome = routes[range.replace(/\.\.\.HEAD$/, '')];
      let result;
      if (!outcome) result = fail(new Error(`unexpected git call: ${(args ?? []).join(' ')}`));
      else if (outcome.fail) result = fail(new Error(outcome.fail));
      else result = ok(outcome.ok ?? '');
      // cross-spawn's full SpawnSyncReturns shape is irrelevant to these tests;
      // the ok()/fail() fixtures carry the only fields safeExec reads.
      return result as never;
    });
  }

  it('prefers origin/<base> over a (possibly stale) local <base> when both resolve', () => {
    // Old order [local, origin] short-circuits on the local ref and would
    // return the stale-local diff; origin-first is the #2054 fix.
    routeDiffByRef({
      'origin/main': { ok: 'ORIGIN_DIFF' },
      main: { ok: 'STALE_LOCAL_DIFF' },
    });
    expect(getGitBranchDiff('/tmp', 'main')).toBe('ORIGIN_DIFF');
    expect(vi.mocked(crossSpawn.sync)).toHaveBeenNthCalledWith(
      1,
      'git',
      ['diff', 'origin/main...HEAD'],
      expect.any(Object),
    );
  });

  it('normalizes an already-origin-prefixed base instead of doubling it (#2074)', () => {
    // base='origin/main' must resolve `origin/main...HEAD`, never `origin/origin/main`.
    routeDiffByRef({
      'origin/main': { ok: 'ORIGIN_DIFF' },
      main: { ok: 'LOCAL_DIFF' },
    });
    expect(getGitBranchDiff('/tmp', 'origin/main')).toBe('ORIGIN_DIFF');
    expect(vi.mocked(crossSpawn.sync)).toHaveBeenNthCalledWith(
      1,
      'git',
      ['diff', 'origin/main...HEAD'],
      expect.any(Object),
    );
  });

  it('falls back to local <base> when origin/<base> is absent (offline / no-remote — nothing lost)', () => {
    routeDiffByRef({
      'origin/main': { fail: "fatal: ambiguous argument 'origin/main...HEAD'" },
      main: { ok: 'LOCAL_DIFF' },
    });
    expect(getGitBranchDiff('/tmp', 'main')).toBe('LOCAL_DIFF');
  });

  it('throws a TotemGitError with a fetch hint when neither ref resolves', () => {
    routeDiffByRef({
      'origin/main': { fail: 'fatal: bad revision' },
      main: { fail: 'fatal: bad revision' },
    });
    let caught: unknown;
    try {
      getGitBranchDiff('/tmp', 'main');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TotemGitError);
    if (caught instanceof TotemGitError) {
      expect(caught.message).toMatch(/Failed to get branch diff \(main\.\.\.HEAD\)/);
      // The fetch hint lives in the recovery field, not the message.
      expect(caught.recoveryHint).toMatch(/git fetch origin main/);
    }
  });
});

describe('getGitBranchDiffResult resolved-base coupling (mmnto-ai/totem#2106 rev-5 item 3)', () => {
  beforeEach(() => vi.clearAllMocks());

  function routeDiffByRef(routes: Record<string, { ok?: string; fail?: string }>): void {
    vi.mocked(crossSpawn.sync).mockImplementation((_command, args) => {
      const range = (args ?? [])[1] ?? '';
      const outcome = routes[range.replace(/\.\.\.HEAD$/, '')];
      let result;
      if (!outcome) result = fail(new Error(`unexpected git call: ${(args ?? []).join(' ')}`));
      else if (outcome.fail) result = fail(new Error(outcome.fail));
      else result = ok(outcome.ok ?? '');
      return result as never;
    });
  }

  it('returns resolvedBase=origin/<base> when the remote diff produced the payload', () => {
    routeDiffByRef({
      'origin/main': { ok: 'ORIGIN_DIFF' },
      main: { ok: 'STALE_LOCAL_DIFF' },
    });
    expect(getGitBranchDiffResult('/tmp', 'main')).toEqual({
      diff: 'ORIGIN_DIFF',
      resolvedBase: 'origin/main',
    });
  });

  it('remote ref EXISTS but its diff FAILS (no merge base) and local succeeds ⇒ resolvedBase is the LOCAL ref', () => {
    // The item-3 falsifier: a separate ref-existence probe would say origin/main exists
    // and mislabel the scope origin-based — but the origin diff itself failed and the
    // payload came from the local ref. The diff operation reports the ref that RAN.
    routeDiffByRef({
      'origin/main': { fail: 'fatal: no merge base' },
      main: { ok: 'LOCAL_DIFF' },
    });
    expect(getGitBranchDiffResult('/tmp', 'main')).toEqual({
      diff: 'LOCAL_DIFF',
      resolvedBase: 'main',
    });
  });

  it('normalizes an origin-prefixed base and still reports the ref that ran', () => {
    routeDiffByRef({
      'origin/main': { fail: 'fatal: bad revision' },
      main: { ok: 'LOCAL_DIFF' },
    });
    expect(getGitBranchDiffResult('/tmp', 'origin/main')).toEqual({
      diff: 'LOCAL_DIFF',
      resolvedBase: 'main',
    });
  });

  it('getGitBranchDiff remains the diff-text-only wrapper (old callers keep compiling)', () => {
    routeDiffByRef({
      'origin/main': { ok: 'ORIGIN_DIFF' },
      main: { ok: 'STALE_LOCAL_DIFF' },
    });
    expect(getGitBranchDiff('/tmp', 'main')).toBe('ORIGIN_DIFF');
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

describe('findRepoRootSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-findroot-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the directory containing .git when called on the root', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    expect(findRepoRootSync(tmpDir)).toBe(path.resolve(tmpDir));
  });

  it('walks upward and finds .git from a nested sub-directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    const nested = path.join(tmpDir, 'packages', 'cli', 'src');
    fs.mkdirSync(nested, { recursive: true });
    expect(findRepoRootSync(nested)).toBe(path.resolve(tmpDir));
  });

  it('returns null when not inside a git repo', () => {
    // tmpDir has no .git directory, parents (system temp / home) shouldn't either
    // — assert null rather than expecting a specific upward result.
    const sub = path.join(tmpDir, 'inner');
    fs.mkdirSync(sub);
    // If the system's temp ancestry happens to contain a .git (unlikely but
    // possible on a dev box), the walk will find that — skip the assertion
    // rather than fail. The contract under test is "returns null when no
    // .git is found"; we just need to give the walk a clean ancestry to
    // exercise that branch.
    const result = findRepoRootSync(sub);
    if (result === null) {
      expect(result).toBeNull();
    } else {
      // Found a .git somewhere upward — verify the helper returned an absolute
      // path and didn't crash; the null-case test is best-effort on systems
      // where the temp dir is nested under a git checkout.
      expect(path.isAbsolute(result)).toBe(true);
    }
  });

  it('returns a path in the input form (does not normalize via subprocess)', () => {
    // Regression coverage for the Windows scenario that motivated this helper:
    // git rev-parse --show-toplevel emits forward slashes and may resolve 8.3
    // short names differently than process.cwd(), which breaks downstream
    // path.relative. JS-side resolution returns the canonical form of the
    // input, so path.relative against findRepoRootSync's result always works.
    fs.mkdirSync(path.join(tmpDir, '.git'));
    const result = findRepoRootSync(tmpDir);
    expect(result).not.toBeNull();
    // Round-trip through path.relative: the manifest path joined onto cwd
    // should compose into a clean relative path against the repo root.
    const manifestPath = path.join(tmpDir, '.totem', 'compile-manifest.json');
    const rel = path.relative(result!, manifestPath);
    expect(rel).toBe(path.join('.totem', 'compile-manifest.json'));
  });

  it('finds .git when it is a file (worktree linked-repo case)', () => {
    // Linked worktrees store a `.git` FILE (not directory) pointing at the
    // main repo's gitdir. existsSync returns true for both, so the walk
    // should still find linked-worktree roots.
    fs.writeFileSync(path.join(tmpDir, '.git'), 'gitdir: /path/to/main.git\n');
    expect(findRepoRootSync(tmpDir)).toBe(path.resolve(tmpDir));
  });
});

describe('findTotemRepoRootSync (mmnto-ai/totem#2312)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-findroot-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the directory containing a .totem dir when called on the root', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'));
    expect(findTotemRepoRootSync(tmpDir)).toBe(path.resolve(tmpDir));
  });

  it('walks up to the .totem-marked root from a deep subdirectory', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'));
    const sub = path.join(tmpDir, '.totem', 'orchestration', 'totem-claude', 'processed');
    fs.mkdirSync(sub, { recursive: true });
    expect(findTotemRepoRootSync(sub)).toBe(path.resolve(tmpDir));
  });

  it('also stops at a .git DIRECTORY marker (no .totem present)', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    const nested = path.join(tmpDir, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(findTotemRepoRootSync(nested)).toBe(path.resolve(tmpDir));
  });

  it('also stops at a .git FILE marker (linked-worktree case)', () => {
    fs.writeFileSync(path.join(tmpDir, '.git'), 'gitdir: /path/to/main.git\n');
    const nested = path.join(tmpDir, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });
    expect(findTotemRepoRootSync(nested)).toBe(path.resolve(tmpDir));
  });

  it('returns null when neither marker is found up the ancestry', () => {
    const sub = path.join(tmpDir, 'inner');
    fs.mkdirSync(sub);
    // Best-effort like findRepoRootSync's null case: a dev box whose temp dir is
    // nested under a checkout could find a marker upward — assert the shape then.
    const result = findTotemRepoRootSync(sub);
    if (result === null) {
      expect(result).toBeNull();
    } else {
      expect(path.isAbsolute(result)).toBe(true);
    }
  });
});

describe('resolveTotemRepoRootSync (mmnto-ai/totem#2312)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-resolveroot-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('derives the marked root from an explicit repoRoot pointing at a subdir', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'));
    const sub = path.join(tmpDir, '.totem', 'orchestration', 'seat', 'processed');
    fs.mkdirSync(sub, { recursive: true });
    expect(resolveTotemRepoRootSync(sub, '/elsewhere')).toBe(path.resolve(tmpDir));
  });

  it('falls back to cwd as the walk start when repoRoot is undefined', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'));
    const sub = path.join(tmpDir, 'nested');
    fs.mkdirSync(sub);
    expect(resolveTotemRepoRootSync(undefined, sub)).toBe(path.resolve(tmpDir));
  });

  it('uses a marker-less start as-is (bare-fixture contract)', () => {
    const bare = path.join(tmpDir, 'bare');
    fs.mkdirSync(bare);
    // Same best-effort guard as the finder's null case: only assert identity
    // when the host ancestry is genuinely marker-free.
    if (findTotemRepoRootSync(bare) === null) {
      expect(resolveTotemRepoRootSync(bare, '/elsewhere')).toBe(path.resolve(bare));
    } else {
      expect(path.isAbsolute(resolveTotemRepoRootSync(bare, '/elsewhere'))).toBe(true);
    }
  });
});
