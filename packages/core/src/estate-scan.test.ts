/**
 * Estate-sensor tests (mmnto-ai/totem#2580 slice-1). One `describe` per
 * invariant in the design's "Invariants to lock in via tests" list — the
 * numbering is load-bearing: these are the claims the sensor is allowed to
 * make, and each one is pinned by the test that names it.
 *
 * Git is never invoked: every fixture injects an exec spy that answers canned
 * porcelain, so the tests assert the CLASSIFIER, not the local git install.
 * The filesystem side (husk sweep) uses real temp trees, because the evidence
 * classes are literally fs shapes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ESTATE_SCHEMA_VERSION,
  type EstateExecFn,
  type EstateScanResult,
  parseWorktreeListPorcelain,
  scanEstate,
} from './estate-scan.js';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const COMMIT_10_DAYS_AGO = Math.floor((NOW - 10 * 86_400_000) / 1000);

let root: string;
/** Fixture dirs outside `root` (e.g. directly under os.tmpdir()) to clean up. */
let extraDirs: string[];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-estate-')));
  extraDirs = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const dir of extraDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A directory whose parent is EXACTLY `os.tmpdir()` — not realpath'd, because
 * the exclusion compares against `os.tmpdir()` as Node reports it (on macOS
 * `realpathSync` resolves /var → /private/var and the parent would no longer
 * match).
 */
function mkTmpdirChild(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  extraDirs.push(dir);
  return dir;
}

// ─── Fixture helpers ────────────────────────────────────

function fold(p: string): string {
  return process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
}

/** A path as git prints it in porcelain output (forward slashes, even on win32). */
function gitPath(p: string): string {
  return p.split(path.sep).join('/');
}

function mkdir(...segments: string[]): string {
  const dir = path.join(root, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface PorcelainEntry {
  path: string;
  head?: string;
  branch?: string;
  detached?: boolean;
  locked?: string | true;
  prunable?: string | true;
}

function porcelain(entries: PorcelainEntry[]): string {
  return (
    entries
      .map((e) => {
        const lines = [`worktree ${gitPath(e.path)}`, `HEAD ${e.head ?? 'a'.repeat(40)}`];
        if (e.detached === true) lines.push('detached');
        else if (e.branch !== undefined) lines.push(`branch ${e.branch}`);
        if (e.locked !== undefined) lines.push(e.locked === true ? 'locked' : `locked ${e.locked}`);
        if (e.prunable !== undefined) {
          lines.push(e.prunable === true ? 'prunable' : `prunable ${e.prunable}`);
        }
        return lines.join('\n');
      })
      .join('\n\n') + '\n'
  );
}

interface EstateFixture {
  /** repo path → porcelain output of `worktree list`. */
  lists: Record<string, string>;
  /** repo path → the `rev-parse --abbrev-ref origin/HEAD` answer. */
  defaultRefs?: Record<string, string>;
  /** Worktree paths whose `status --porcelain` reports changes. */
  dirty?: string[];
  /** Full refs that ARE ancestors of the default branch. */
  merged?: string[];
  /** Worktree paths whose `status --porcelain` throws. */
  failStatus?: string[];
  /** Refs whose `merge-base` throws a real error (not the exit-1 "not ancestor"). */
  failAncestry?: string[];
}

function execFailure(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Canned git, recording every invocation for the allowlist assertion. */
function makeExec(fixture: EstateFixture, calls: string[][]): EstateExecFn {
  const lists = new Map(Object.entries(fixture.lists).map(([k, v]) => [fold(k), v]));
  const refs = new Map(Object.entries(fixture.defaultRefs ?? {}).map(([k, v]) => [fold(k), v]));
  const dirty = new Set((fixture.dirty ?? []).map(fold));
  const merged = new Set(fixture.merged ?? []);
  const failStatus = new Set((fixture.failStatus ?? []).map(fold));
  const failAncestry = new Set(fixture.failAncestry ?? []);

  return (command: string, args: string[] = []): string => {
    calls.push([command, ...args]);
    const cwd = args[1] ?? '';
    const verb = args.slice(2);
    const key = fold(cwd);

    if (verb[0] === 'worktree') {
      const listed = lists.get(key);
      if (listed === undefined) throw execFailure(`not a git repository: ${cwd}`, 128);
      return listed;
    }
    if (verb[0] === 'rev-parse') {
      const ref = refs.get(key);
      if (ref === undefined) throw execFailure('ambiguous argument origin/HEAD', 128);
      return ref;
    }
    if (verb[0] === 'status') {
      if (failStatus.has(key)) throw execFailure('fatal: unable to read index', 128);
      return dirty.has(key) ? ' M packages/core/src/index.ts' : '';
    }
    if (verb[0] === 'merge-base') {
      const ref = verb[2] ?? '';
      if (failAncestry.has(ref)) throw execFailure(`bad revision ${ref}`, 128);
      if (merged.has(ref)) return '';
      throw execFailure('', NOT_AN_ANCESTOR);
    }
    if (verb[0] === 'log') return String(COMMIT_10_DAYS_AGO);
    throw execFailure(`unexpected git verb: ${verb.join(' ')}`, 1);
  };
}

const NOT_AN_ANCESTOR = 1;

/** A `.git` file pointing at `target` — the linked-worktree pointer shape. */
function writeGitdirPointer(dir: string, target: string): void {
  fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${gitPath(target)}\n`, 'utf-8');
}

function classesOf(result: EstateScanResult): Record<string, string> {
  return Object.fromEntries(result.worktrees.map((w) => [path.basename(w.path), w.class]));
}

/** Every entry under `dir` with its kind, size, and mtime — a write-detector. */
function treeSnapshot(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const stat = fs.lstatSync(abs);
    out.push(`${rel} ${entry.isDirectory() ? 'dir' : 'file'} ${stat.size} ${stat.mtimeMs}`);
    if (entry.isDirectory()) out.push(...treeSnapshot(abs, rel));
  }
  return out;
}

// ─── Parser ─────────────────────────────────────────────

describe('parseWorktreeListPorcelain', () => {
  it('parses every documented field across blank-line-separated entries', () => {
    const raw = [
      'worktree /dev/totem',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /dev/totem-2580',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/2580-estate-sensor',
      'locked under review',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /dev/totem-detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
      'worktree /dev/bare-mirror',
      'bare',
      '',
    ].join('\n');

    const entries = parseWorktreeListPorcelain(raw);
    expect(entries.map((e) => e.path)).toEqual([
      '/dev/totem',
      '/dev/totem-2580',
      '/dev/totem-detached',
      '/dev/bare-mirror',
    ]);
    expect(entries[0]!.branch).toBe('refs/heads/main');
    expect(entries[1]!.locked).toBe(true);
    expect(entries[1]!.lockedReason).toBe('under review');
    expect(entries[1]!.prunable).toBe(true);
    expect(entries[1]!.prunableReason).toBe('gitdir file points to non-existent location');
    expect(entries[2]!.detached).toBe(true);
    expect(entries[2]!.branch).toBeUndefined();
    expect(entries[3]!.bare).toBe(true);
  });

  it('tolerates CRLF, a bare `locked`, unknown attributes, and a missing trailing blank line', () => {
    const raw = [
      'worktree C:/dev/totem',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      'some-future-attribute whatever',
      '',
      'worktree C:/dev/totem-wt',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      'locked',
    ].join('\r\n');

    const entries = parseWorktreeListPorcelain(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.path).toBe('C:/dev/totem');
    expect(entries[1]!.locked).toBe(true);
    expect(entries[1]!.lockedReason).toBeUndefined();
  });

  it('returns nothing for empty output', () => {
    expect(parseWorktreeListPorcelain('')).toEqual([]);
  });
});

// ─── Invariant 1 ────────────────────────────────────────

describe('invariant 1 — a path in any repo worktree list is NEVER a husk candidate', () => {
  it('joins registered worktrees case-folded on win32 so a drive-case disagreement cannot double-report', () => {
    const repo = mkdir('repo');
    const wt = mkdir('repo-2580');
    // The worktree carries a DANGLING pointer, so it would be a husk on
    // evidence alone — only the registered-worktree join keeps it out.
    writeGitdirPointer(wt, path.join(root, 'repo', '.git', 'worktrees', 'repo-2580'));

    // Git and Node disagreeing on drive-letter case is the win32 hazard the
    // fold exists for (GCA #2293); on POSIX the same path is passed through
    // unfolded, since folding there would conflate genuinely distinct paths.
    const asGitPrintsIt =
      process.platform === 'win32'
        ? wt.charAt(0).toLowerCase() === wt.charAt(0)
          ? wt.charAt(0).toUpperCase() + wt.slice(1)
          : wt.charAt(0).toLowerCase() + wt.slice(1)
        : wt;

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: asGitPrintsIt, branch: 'refs/heads/2580' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
          merged: ['refs/heads/2580'],
        },
        calls,
      ),
    });

    expect(result.huskCandidates).toEqual([]);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]!.class).toBe('registered-stale');
  });

  it('never husks the main worktree (the repo itself) even though it is swept', () => {
    const repo = mkdir('repo');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    expect(result.huskCandidates).toEqual([]);
    expect(result.worktrees).toEqual([]);
    expect(result.repos[0]!.worktrees).toBe(0);
  });
});

// ─── Invariant 2 ────────────────────────────────────────

describe('invariant 2 — clean+unmerged is indeterminate, never stale (squash honesty)', () => {
  function threeWorktrees(): EstateScanResult {
    const repo = mkdir('repo');
    const stale = mkdir('repo-stale');
    const open = mkdir('repo-open');
    const dirty = mkdir('repo-dirty');
    const calls: string[][] = [];
    return scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: stale, branch: 'refs/heads/stale' },
              { path: open, branch: 'refs/heads/open' },
              { path: dirty, branch: 'refs/heads/dirty' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
          // `dirty` is ALSO merged — invariant 2's "dirty is active regardless
          // of merge state" is only tested if the merge state would say stale.
          merged: ['refs/heads/stale', 'refs/heads/dirty'],
          dirty: [dirty],
        },
        calls,
      ),
    });
  }

  it('classifies clean+merged stale, clean+unmerged indeterminate, dirty active', () => {
    const classes = classesOf(threeWorktrees());
    expect(classes['repo-stale']).toBe('registered-stale');
    expect(classes['repo-open']).toBe('registered-indeterminate');
    expect(classes['repo-dirty']).toBe('registered-active');
  });

  it('records ancestryMerged honestly and names the squash gap in the evidence', () => {
    const result = threeWorktrees();
    const open = result.worktrees.find((w) => w.branch === 'open')!;
    const dirty = result.worktrees.find((w) => w.branch === 'dirty')!;
    expect(open.ancestryMerged).toBe(false);
    expect(open.evidence).toContain('squash-merged');
    // Never probed for a dirty tree — so the field says unknown, not false.
    expect(dirty.ancestryMerged).toBe('unknown');
    expect(result.worktrees.find((w) => w.branch === 'stale')!.ancestryMerged).toBe(true);
  });

  it('falls back to indeterminate (not stale) when the default branch is underivable', () => {
    const repo = mkdir('repo');
    const wt = mkdir('repo-wt');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: wt, branch: 'refs/heads/wt' },
            ]),
          },
          // No defaultRefs entry: `rev-parse --abbrev-ref origin/HEAD` throws.
        },
        calls,
      ),
    });
    expect(result.worktrees[0]!.class).toBe('registered-indeterminate');
    expect(result.worktrees[0]!.ancestryMerged).toBe('unknown');
    expect(result.repos[0]!.defaultBranch).toBeUndefined();
    expect(calls.some((c) => c.includes('merge-base'))).toBe(false);
  });

  it('classifies a detached worktree as detached and never probes its ancestry', () => {
    const repo = mkdir('repo');
    const wt = mkdir('repo-detached');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: wt, detached: true },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
        },
        calls,
      ),
    });
    expect(result.worktrees[0]!.class).toBe('registered-detached');
    expect(result.worktrees[0]!.ageDays).toBe(10);
    expect(calls.some((c) => c.includes('merge-base'))).toBe(false);
  });
});

// ─── Invariant 3 ────────────────────────────────────────

describe('invariant 3 — husks require typed evidence; a `.git` DIRECTORY is never one', () => {
  it('reports residue-shape and skips both the real checkout and the shapeless dir', () => {
    const repo = mkdir('repo');
    mkdir('repo-residue', 'node_modules');
    mkdir('sibling-checkout', '.git');
    mkdir('unrelated-empty-dir');

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });

    const husks = Object.fromEntries(
      result.huskCandidates.map((h) => [path.basename(h.path), h.evidence]),
    );
    expect(husks).toEqual({ 'repo-residue': 'residue-shape' });
    expect(result.huskCandidates[0]!.matchedRepo).toBe(repo);
    for (const husk of result.huskCandidates) {
      expect(['dangling-gitdir-pointer', 'residue-shape', 'deregistered-intact']).toContain(
        husk.evidence,
      );
    }
  });

  it('does not husk a live worktree of an UNREGISTERED repo (its home repo still lists it)', () => {
    const repo = mkdir('repo');
    const otherRepo = mkdir('other');
    const otherWt = mkdir('other-wt');
    const gitdir = mkdir('other', '.git', 'worktrees', 'other-wt');
    writeGitdirPointer(otherWt, gitdir);

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]),
            [otherRepo]: porcelain([
              { path: otherRepo, branch: 'refs/heads/main' },
              { path: otherWt, branch: 'refs/heads/side' },
            ]),
          },
        },
        calls,
      ),
    });
    expect(result.huskCandidates).toEqual([]);
  });

  it('reports deregistered-intact when the home repo no longer lists an intact pointer', () => {
    const repo = mkdir('repo');
    const otherRepo = mkdir('other');
    const orphan = mkdir('other-orphan');
    const gitdir = mkdir('other', '.git', 'worktrees', 'other-orphan');
    writeGitdirPointer(orphan, gitdir);

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]),
            [otherRepo]: porcelain([{ path: otherRepo, branch: 'refs/heads/main' }]),
          },
        },
        calls,
      ),
    });
    expect(result.huskCandidates).toHaveLength(1);
    expect(result.huskCandidates[0]!.evidence).toBe('deregistered-intact');
    expect(result.huskCandidates[0]!.matchedRepo).toBe(otherRepo);
    expect(result.huskCandidates[0]!.ageDays).toBe(0);
  });
});

// ─── Invariant 4 ────────────────────────────────────────

describe('invariant 4 — a dangling `.git` pointer is a husk regardless of the directory name', () => {
  it('reports a dangling pointer under a name matching no convention', () => {
    const repo = mkdir('repo');
    const odd = mkdir('zzz-scratch-42');
    writeGitdirPointer(odd, path.join(root, 'gone', '.git', 'worktrees', 'zzz'));

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    expect(result.huskCandidates).toHaveLength(1);
    expect(result.huskCandidates[0]!.path).toBe(odd);
    expect(result.huskCandidates[0]!.evidence).toBe('dangling-gitdir-pointer');
    expect(result.huskCandidates[0]!.sweptRoot).toBe(root);
  });
});

// ─── Invariant 5 ────────────────────────────────────────

describe('invariant 5 — total accounting: nothing is dropped, counts equal rows', () => {
  function mixedEstate(): EstateScanResult {
    const repo = mkdir('repo');
    const stale = mkdir('repo-stale');
    const open = mkdir('repo-open');
    const broken = mkdir('repo-broken');
    const husk = mkdir('zzz-husk');
    writeGitdirPointer(husk, path.join(root, 'gone', '.git', 'worktrees', 'zzz-husk'));

    const calls: string[][] = [];
    return scanEstate({
      registry: [
        { path: repo, lastSync: '2026-08-01T00:00:00.000Z' },
        { path: path.join(root, 'vanished') },
      ],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: stale, branch: 'refs/heads/stale' },
              { path: open, branch: 'refs/heads/open' },
              { path: broken, branch: 'refs/heads/broken' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
          merged: ['refs/heads/stale'],
          failStatus: [broken],
        },
        calls,
      ),
    });
  }

  it('lands every enumerated candidate in exactly one bucket', () => {
    const result = mixedEstate();
    const classified = result.worktrees.filter((w) => w.class !== 'unscannable').map((w) => w.path);
    const husks = result.huskCandidates.map((h) => h.path);
    const failed = result.unscannable.map((u) => u.path);
    const all = [...classified, ...husks, ...failed];
    expect(new Set(all).size).toBe(all.length);

    // A worktree whose probe failed is class-unscannable AND carries a named
    // failure row — the degraded state is never silent.
    const unscannableWorktrees = result.worktrees.filter((w) => w.class === 'unscannable');
    expect(unscannableWorktrees).toHaveLength(1);
    for (const w of unscannableWorktrees) {
      expect(failed).toContain(w.path);
      expect(w.evidence).toContain('status --porcelain failed');
    }
  });

  it('keeps summary counts equal to the row counts', () => {
    const result = mixedEstate();
    const s = result.summary;
    expect(s.worktrees).toBe(result.worktrees.length);
    expect(s.active + s.stale + s.indeterminate + s.detached + s.unscannableWorktrees).toBe(
      result.worktrees.length,
    );
    expect(s.huskCandidates).toBe(result.huskCandidates.length);
    expect(s.unscannable).toBe(result.unscannable.length);
    expect(s.repos).toBe(result.repos.length);
    expect(s.reposMissing).toBe(1);
    expect(result.repos.find((r) => r.missing === true)!.path).toBe(path.join(root, 'vanished'));
  });

  it('discloses every swept root and never scans a missing registry path', () => {
    const result = mixedEstate();
    expect(result.sweptRoots).toContain(root);
    expect(result.repos.find((r) => r.missing === true)!.worktrees).toBe(0);
  });

  it('records an unscannable row (and no husk rows) for an unreadable sweep root', () => {
    const repo = mkdir('repo');
    const missingRoot = path.join(root, 'no-such-root');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      extraRoots: [missingRoot],
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    expect(result.sweptRoots).toContain(missingRoot);
    expect(result.unscannable.map((u) => u.path)).toContain(missingRoot);
    expect(result.unscannable[0]!.reason).toContain('sweep root unreadable');
  });
});

// ─── Sweep-root derivation ──────────────────────────────

describe('sweep-root derivation — evidence-ranked, disclosed when narrowed', () => {
  it('does not derive a root from a MISSING registry entry (T1)', () => {
    const repo = mkdir('repo');
    const nested = path.join(root, 'nested');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }, { path: path.join(nested, 'gone') }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    expect(result.sweptRoots).toContain(root);
    expect(result.sweptRoots).not.toContain(nested);
    expect(result.excludedRoots).toEqual([]);
    expect(result.repos.find((r) => r.missing === true)!.path).toBe(path.join(nested, 'gone'));
  });

  it('excludes os.tmpdir() when only a registry entry derives it, and says so (T2)', () => {
    const repo = mkTmpdirChild('totem-estate-tmproot-');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    expect(result.sweptRoots).not.toContain(path.resolve(os.tmpdir()));
    expect(result.excludedRoots).toHaveLength(1);
    expect(result.excludedRoots[0]!.path).toBe(path.resolve(os.tmpdir()));
    expect(result.excludedRoots[0]!.reason).toBe(
      'os tmpdir — derived only from a registry entry path; pass --root to sweep it',
    );
  });

  it('sweeps os.tmpdir() when a LISTED WORKTREE parent derives it (T3)', () => {
    const repo = mkTmpdirChild('totem-estate-tmproot-');
    const wt = mkTmpdirChild('totem-estate-tmpwt-');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: wt, branch: 'refs/heads/side' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
        },
        calls,
      ),
    });
    // A live worktree in the temp dir IS evidence that worktrees live there.
    expect(result.sweptRoots).toContain(path.resolve(os.tmpdir()));
    expect(result.excludedRoots).toEqual([]);
  });

  it('sweeps os.tmpdir() when --root names it explicitly (T4)', () => {
    const repo = mkTmpdirChild('totem-estate-tmproot-');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      extraRoots: [os.tmpdir()],
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    expect(result.sweptRoots).toContain(path.resolve(os.tmpdir()));
    expect(result.excludedRoots).toEqual([]);
  });
});

// ─── Residue attribution ────────────────────────────────

describe('residue-shape attribution takes the most specific repo name', () => {
  it('attributes a husk to the LONGEST matching registered basename (T5)', () => {
    const totem = mkdir('totem');
    const strategy = mkdir('totem-strategy');
    const husk = mkdir('totem-strategy-claude-x');
    fs.mkdirSync(path.join(husk, 'node_modules'));

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: totem }, { path: strategy }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [totem]: porcelain([{ path: totem, branch: 'refs/heads/main' }]),
            [strategy]: porcelain([{ path: strategy, branch: 'refs/heads/main' }]),
          },
        },
        calls,
      ),
    });
    expect(result.huskCandidates).toHaveLength(1);
    expect(result.huskCandidates[0]!.path).toBe(husk);
    expect(result.huskCandidates[0]!.evidence).toBe('residue-shape');
    expect(result.huskCandidates[0]!.matchedRepo).toBe(strategy);
  });
});

// ─── Invariant 6 ────────────────────────────────────────

describe('invariant 6 — an empty registry yields a valid, degenerate result', () => {
  it('returns a zeroed result and invokes git zero times', () => {
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [],
      now: NOW,
      safeExec: makeExec({ lists: {} }, calls),
    });
    expect(calls).toEqual([]);
    expect(result.schemaVersion).toBe(ESTATE_SCHEMA_VERSION);
    expect(result.derivedAt).toBe('2026-08-05T12:00:00.000Z');
    expect(result.repos).toEqual([]);
    expect(result.worktrees).toEqual([]);
    expect(result.huskCandidates).toEqual([]);
    expect(result.unscannable).toEqual([]);
    expect(result.sweptRoots).toEqual([]);
    expect(result.excludedRoots).toEqual([]);
    expect(result.summary).toEqual({
      repos: 0,
      reposMissing: 0,
      worktrees: 0,
      active: 0,
      stale: 0,
      indeterminate: 0,
      detached: 0,
      unscannableWorktrees: 0,
      huskCandidates: 0,
      unscannable: 0,
    });
  });
});

// ─── Invariant 7 ────────────────────────────────────────

describe('invariant 7 — read verbs only, zero filesystem writes', () => {
  const READ_VERBS = [
    'worktree list --porcelain',
    'status --porcelain',
    'merge-base --is-ancestor',
    'log -1 --format=%ct',
    'rev-parse --abbrev-ref',
  ];

  it('invokes no git verb outside the read allowlist across a full mixed scan', () => {
    const repo = mkdir('repo');
    const stale = mkdir('repo-stale');
    const open = mkdir('repo-open');
    const detached = mkdir('repo-detached');
    const husk = mkdir('zzz-husk');
    writeGitdirPointer(husk, path.join(root, 'gone', '.git', 'worktrees', 'zzz-husk'));

    const calls: string[][] = [];
    scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: stale, branch: 'refs/heads/stale' },
              { path: open, branch: 'refs/heads/open' },
              { path: detached, detached: true },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
          merged: ['refs/heads/stale'],
          dirty: [open],
        },
        calls,
      ),
    });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call[0]).toBe('git');
      // Every invocation is `git -C <path> <verb…>`; the verb is what the
      // allowlist constrains.
      expect(call[1]).toBe('-C');
      const verb = call.slice(3).join(' ');
      expect(
        READ_VERBS.some((allowed) => verb.startsWith(allowed)),
        `non-read git verb invoked: ${verb}`,
      ).toBe(true);
    }
  });

  it('leaves the swept tree byte-identical (zero filesystem writes)', () => {
    // Asserted on the TREE rather than on fs spies: an artifact impossible to
    // produce without actually touching the referent, and indifferent to which
    // write primitive a regression would reach for.
    const repo = mkdir('repo');
    const wt = mkdir('repo-wt');
    const husk = mkdir('zzz-husk');
    writeGitdirPointer(husk, path.join(root, 'gone', '.git', 'worktrees', 'zzz-husk'));

    const before = treeSnapshot(root);
    const calls: string[][] = [];
    scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: wt, branch: 'refs/heads/wt' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
        },
        calls,
      ),
    });
    expect(treeSnapshot(root)).toEqual(before);
  });
});

// ─── Invariant 8 ────────────────────────────────────────

describe('invariant 8 — the scan owns no output stream', () => {
  it('emits nothing on stdout or stderr, so the CLI alone decides the surface', () => {
    const repo = mkdir('repo');
    const wt = mkdir('repo-wt');
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const calls: string[][] = [];
      scanEstate({
        registry: [{ path: repo }],
        now: NOW,
        safeExec: makeExec(
          {
            lists: {
              [repo]: porcelain([
                { path: repo, branch: 'refs/heads/main' },
                { path: wt, branch: 'refs/heads/wt' },
              ]),
            },
            defaultRefs: { [repo]: 'origin/main' },
          },
          calls,
        ),
      });
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
      expect(consoleLog).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }
  });
});
