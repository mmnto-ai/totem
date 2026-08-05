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
 *
 * Known untested arm: the mid-sweep TOCTOU path in `classifyHusk` (a directory
 * that readdir named and that vanishes before the `.git` probe, recorded as
 * `vanished or turned unreadable mid-sweep`). Reaching it needs a race between
 * two fs syscalls, which is not portably schedulable without an fs seam the
 * scan does not have. Recorded as a gap rather than covered by a test that
 * would assert nothing.
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
  /**
   * Registry path → the toplevel git discovers from it. Defaults to the path
   * itself (the entry IS a git root); set it to an ANCESTOR to fixture the
   * not-git-root case.
   */
  toplevels?: Record<string, string>;
  /** Paths whose `rev-parse --show-toplevel` throws. */
  failToplevel?: string[];
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
  const toplevels = new Map(Object.entries(fixture.toplevels ?? {}).map(([k, v]) => [fold(k), v]));
  const failToplevel = new Set((fixture.failToplevel ?? []).map(fold));

  return (command: string, args: string[] = []): string => {
    calls.push([command, ...args]);
    // Production argv is `git --no-optional-locks -C <cwd> <verb…>`.
    const cwd = args[2] ?? '';
    const verb = args.slice(3);
    const key = fold(cwd);

    if (verb[0] === 'worktree') {
      const listed = lists.get(key);
      if (listed === undefined) throw execFailure(`not a git repository: ${cwd}`, 128);
      return listed;
    }
    if (verb[0] === 'rev-parse' && verb[1] === '--show-toplevel') {
      if (failToplevel.has(key)) throw execFailure(`not a git repository: ${cwd}`, 128);
      // Default: the probed path IS the git root.
      return gitPath(toplevels.get(key) ?? path.resolve(cwd));
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

/** Swept-root paths only — the kind is asserted separately where it matters. */
function rootPaths(result: EstateScanResult): string[] {
  return result.sweptRoots.map((r) => r.path);
}

/** The sweep-axis failure ledger — the only axis the candidate partition covers. */
function sweepFailures(result: EstateScanResult): string[] {
  const rootPaths = new Set(result.sweptRoots.map((r) => r.path));
  // Root-level failures are keyed by the ROOT, not by a candidate, so they sit
  // OUTSIDE the candidate partition: the same path can be a failed root here
  // and a candidate row under its own parent. Excluded from every partition
  // assertion for that reason.
  return result.unscannable
    .filter((u) => u.source === 'sweep' && !rootPaths.has(u.path))
    .map((u) => u.path);
}

/** Sweep-source rows keyed by a swept ROOT — the namespace the partition excludes. */
function rootFailures(result: EstateScanResult): EstateScanResult['unscannable'] {
  const rootPathSet = new Set(result.sweptRoots.map((r) => r.path));
  return result.unscannable.filter((u) => u.source === 'sweep' && rootPathSet.has(u.path));
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
  /**
   * The fold is platform-conditional, so BOTH arms are exercised by stubbing
   * `process.platform` — otherwise the POSIX assertion is a tautology on a
   * Windows host and vice versa. The fixture is identical in both runs: a
   * container root holding a directory whose on-disk name differs from the
   * listed worktree path only in case.
   */
  function foldFixture(platform: string): EstateScanResult {
    const repo = mkdir('repo');
    mkdir('repo', '.claude', 'worktrees');
    const onDisk = mkdir('repo', '.claude', 'worktrees', 'agent-x');
    const asGitPrintsIt = path.join(root, 'repo', '.claude', 'worktrees', 'AGENT-X');
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    try {
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
      expect(path.basename(onDisk)).toBe('agent-x');
      return result;
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  }

  it('win32: a drive/case disagreement between git and Node cannot double-report a live worktree', () => {
    const result = foldFixture('win32');
    // Folded join: git's `AGENT-X` and the on-disk `agent-x` are the SAME path,
    // so the live worktree is never also a husk candidate (GCA #2293).
    expect(result.huskCandidates).toEqual([]);
    expect(result.worktrees).toHaveLength(1);
    expect(result.worktrees[0]!.class).toBe('registered-stale');
  });

  it('POSIX: two case-divergent paths stay DISTINCT — a listed /A/wt does not protect /a/wt', () => {
    const result = foldFixture('linux');
    // Unfolded join: `AGENT-X` protects only itself. The on-disk `agent-x` is a
    // genuinely different path on a case-sensitive filesystem and stays a
    // candidate — folding here would conflate real paths.
    expect(result.huskCandidates.map((h) => path.basename(h.path))).toEqual(['agent-x']);
    expect(result.huskCandidates[0]!.evidence).toBe('container-residue');
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
  it('gives a shapeless `.git` pointer NO evidence under a STANDARD root', () => {
    const repo = mkdir('repo');
    const shapeless = mkdir('repo-shapeless');
    fs.writeFileSync(path.join(shapeless, '.git'), 'no gitdir line here\n', 'utf-8');
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
  });

  it('gives an unresolvable pointer target NO evidence under a STANDARD root', () => {
    const repo = mkdir('repo');
    const target = mkdir('somewhere-else');
    const odd = mkdir('repo-odd');
    writeGitdirPointer(odd, target);
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
  });

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

  // The prefix is hyphen-BOUNDED: `<repo>-…` is the worktree naming
  // convention's own shape, while a name that merely BEGINS with a repo's
  // (`repoville` vs `repo`) is an ordinary project, not residue.
  it('does not husk a `.git`-less project whose name merely begins with a repo name', () => {
    const repo = mkdir('repo');
    mkdir('repoville', 'node_modules');
    mkdir('repo-ville', 'node_modules');

    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        [],
      ),
    });

    expect(result.huskCandidates.map((h) => path.basename(h.path))).toEqual(['repo-ville']);
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

  it('lands every enumerated candidate in exactly one bucket ON THE SWEEP AXIS', () => {
    const result = mixedEstate();
    // The partition is defined over the SWEEP axis: worktree rows, husk rows,
    // and sweep-source failures. Registry- and worktree-source ledger rows are
    // a different axis (registry accounting) and MAY share a path with a husk
    // row — the two-axes rule.
    const classified = result.worktrees.filter((w) => w.class !== 'unscannable').map((w) => w.path);
    const husks = result.huskCandidates.map((h) => h.path);
    const sweepFailed = sweepFailures(result);
    const all = [...classified, ...husks, ...sweepFailed];
    expect(new Set(all).size).toBe(all.length);

    // A worktree whose probe failed is class-unscannable AND carries a named
    // worktree-source failure row — the degraded state is never silent.
    const unscannableWorktrees = result.worktrees.filter((w) => w.class === 'unscannable');
    expect(unscannableWorktrees).toHaveLength(1);
    const worktreeFailed = result.unscannable
      .filter((u) => u.source === 'worktree')
      .map((u) => u.path);
    for (const w of unscannableWorktrees) {
      expect(worktreeFailed).toContain(w.path);
      expect(w.evidence).toContain('status --porcelain failed');
    }
  });

  it('tags every ledger row with its axis', () => {
    const result = mixedEstate();
    for (const row of result.unscannable) {
      expect(['registry', 'worktree', 'sweep']).toContain(row.source);
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
    expect(rootPaths(result)).toContain(root);
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
    expect(rootPaths(result)).toContain(missingRoot);
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
    expect(rootPaths(result)).toContain(root);
    expect(rootPaths(result)).not.toContain(nested);
    // Suppressed, not silently dropped (the disclosure covers every narrowing).
    expect(result.excludedRoots).toEqual([
      { path: nested, reason: 'not derived: derived from missing registry entry path(s)' },
    ]);
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
    expect(rootPaths(result)).not.toContain(path.resolve(os.tmpdir()));
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
    expect(rootPaths(result)).toContain(path.resolve(os.tmpdir()));
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
    expect(rootPaths(result)).toContain(path.resolve(os.tmpdir()));
    expect(result.excludedRoots).toEqual([]);
  });
});

// ─── Toplevel verification ──────────────────────────────

describe('registered arm — a registry entry must be a git TOPLEVEL to be enumerated', () => {
  it('reports a not-git-root entry with its enclosing repo and derives nothing from it', () => {
    const repo = mkdir('repo');
    const inside = mkdir('repo', 'packages', 'core');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }, { path: inside }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) },
          // git -C <repo>/packages/core discovers the ANCESTOR repo.
          toplevels: { [inside]: repo },
        },
        calls,
      ),
    });

    const row = result.repos.find((r) => r.path === inside)!;
    expect(row.notGitRoot).toBe(true);
    expect(row.enclosingRepo).toBe(repo);
    expect(row.worktrees).toBe(0);
    // Neither its dirname nor git's ancestor answer may feed the sweep.
    expect(rootPaths(result)).not.toContain(path.join(repo, 'packages'));
    expect(result.excludedRoots.map((r) => r.path)).toContain(path.join(repo, 'packages'));
    expect(result.excludedRoots.find((r) => r.path === path.join(repo, 'packages'))!.reason).toBe(
      'not derived: derived from non-git-root registry entry path(s)',
    );
    // The ancestor's worktree list is never requested on its behalf.
    expect(calls.filter((c) => c.includes('worktree'))).toHaveLength(1);
  });

  it('keeps the unscannable-repo path when the toplevel probe itself fails', () => {
    const repo = mkdir('repo');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec({ lists: {}, failToplevel: [repo] }, calls),
    });
    expect(result.repos).toHaveLength(1);
    expect(result.repos[0]!.notGitRoot).toBeUndefined();
    expect(result.unscannable).toHaveLength(1);
    expect(result.unscannable[0]!.reason).toContain('rev-parse --show-toplevel failed');
    expect(result.unscannable[0]!.source).toBe('registry');
    expect(result.summary.reposUnscannable).toBe(1);
    expect(calls.some((c) => c.includes('worktree'))).toBe(false);
  });

  it('derives NOTHING from an entry whose toplevel could not be verified', () => {
    // The unverifiable entry sits next to a node_modules-bearing sibling that
    // would qualify as residue-shape if its parent were swept on its account.
    const unverifiable = mkdir('nested', 'maybe-repo');
    const sibling = mkdir('nested', 'maybe-repo-residue');
    fs.mkdirSync(path.join(sibling, 'node_modules'));

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: unverifiable }],
      now: NOW,
      safeExec: makeExec({ lists: {}, failToplevel: [unverifiable] }, calls),
    });

    expect(rootPaths(result)).not.toContain(path.join(root, 'nested'));
    expect(result.huskCandidates).toEqual([]);
    expect(result.excludedRoots).toEqual([
      {
        path: path.join(root, 'nested'),
        reason: 'not derived: derived from unverifiable registry entry path(s)',
      },
    ]);
  });

  it('lets a VERIFIED sibling derive the same root — both axes then coexist', () => {
    // Same tree, but a verified repo shares the parent, so the root IS swept.
    const unverifiable = mkdir('nested', 'maybe-repo');
    fs.mkdirSync(path.join(unverifiable, 'node_modules'));
    const verified = mkdir('nested', 'maybe');

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: unverifiable }, { path: verified }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: { [verified]: porcelain([{ path: verified, branch: 'refs/heads/main' }]) },
          failToplevel: [unverifiable],
        },
        calls,
      ),
    });

    expect(rootPaths(result)).toContain(path.join(root, 'nested'));
    // The unverifiable entry's path carries BOTH a registry-source ledger row
    // and a husk row — different axes, so this is not a partition violation.
    expect(result.unscannable.filter((u) => u.path === unverifiable)[0]!.source).toBe('registry');
    expect(result.huskCandidates.map((h) => h.path)).toContain(unverifiable);
    // The sweep-axis partition still holds.
    const classified = result.worktrees.map((w) => w.path);
    const all = [
      ...classified,
      ...result.huskCandidates.map((h) => h.path),
      ...sweepFailures(result),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('never lets an unverified entry attribute a residue-shape row to itself', () => {
    const unverifiable = mkdir('nested', 'maybe-repo');
    fs.mkdirSync(path.join(unverifiable, 'node_modules'));
    const verified = mkdir('nested', 'maybe');

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: unverifiable }, { path: verified }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: { [verified]: porcelain([{ path: verified, branch: 'refs/heads/main' }]) },
          failToplevel: [unverifiable],
        },
        calls,
      ),
    });
    const husk = result.huskCandidates.find((h) => h.path === unverifiable)!;
    expect(husk.evidence).toBe('residue-shape');
    // Attribution names the VERIFIED repo, never the husk's own registry entry.
    expect(husk.matchedRepo).toBe(verified);
    expect(husk.matchedRepo).not.toBe(unverifiable);
  });
});

// ─── Container roots ────────────────────────────────────

describe('container roots — location is the evidence', () => {
  function containerEstate(extraRoots?: string[]): EstateScanResult {
    const repo = mkdir('repo');
    mkdir('repo', '.claude', 'worktrees', 'agent-abc');
    mkdir('repo', '.claude', 'worktrees', 'kimi-2385');
    const live = path.join(root, 'repo', '.claude', 'worktrees', 'agent-live');
    fs.mkdirSync(live, { recursive: true });

    const calls: string[][] = [];
    return scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      ...(extraRoots === undefined ? {} : { extraRoots }),
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: live, branch: 'refs/heads/live' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
        },
        calls,
      ),
    });
  }

  it('sweeps <repo>/.claude/worktrees and reports untracked dirs as container-residue', () => {
    const result = containerEstate();
    expect(rootPaths(result)).toContain(path.join(root, 'repo', '.claude', 'worktrees'));
    const husks = Object.fromEntries(
      result.huskCandidates.map((h) => [path.basename(h.path), h.evidence]),
    );
    // No name convention, no node_modules, no `.git` at all — the location
    // alone qualifies them.
    expect(husks).toEqual({ 'agent-abc': 'container-residue', 'kimi-2385': 'container-residue' });
  });

  it('never husks a LIVE worktree inside a container root', () => {
    const result = containerEstate();
    expect(result.huskCandidates.map((h) => path.basename(h.path))).not.toContain('agent-live');
    expect(result.worktrees.map((w) => path.basename(w.path))).toContain('agent-live');
  });

  it('treats a --root as a container declaration too', () => {
    const scratch = mkdir('scratch');
    fs.mkdirSync(path.join(scratch, 'leftover-wt'));
    const result = containerEstate([scratch]);
    const leftover = result.huskCandidates.find(
      (h) => h.path === path.join(scratch, 'leftover-wt'),
    )!;
    expect(leftover.evidence).toBe('container-residue');
  });

  it('still refuses a `.git`-DIRECTORY dir under a container root', () => {
    const repo = mkdir('repo');
    mkdir('repo', '.claude', 'worktrees', 'real-clone', '.git');
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
  });

  it('prefers the stronger dangling-pointer class over container-residue', () => {
    const repo = mkdir('repo');
    const dangling = mkdir('repo', '.claude', 'worktrees', 'agent-dangling');
    writeGitdirPointer(dangling, path.join(root, 'gone', '.git', 'worktrees', 'agent-dangling'));
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
    expect(result.huskCandidates[0]!.evidence).toBe('dangling-gitdir-pointer');
  });

  it('withdraws the container root when the repo worktree list failed', () => {
    // Without the repo's live-worktree list, container-residue cannot tell a
    // live worktree from residue — a degraded scan must not read DIRTIER.
    const repo = mkdir('repo');
    mkdir('repo', '.claude', 'worktrees', 'agent-a');
    mkdir('repo', '.claude', 'worktrees', 'agent-b');
    const container = path.join(root, 'repo', '.claude', 'worktrees');

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      // `lists` is empty, so `worktree list` throws for this repo.
      safeExec: makeExec({ lists: {} }, calls),
    });

    expect(rootPaths(result)).not.toContain(container);
    expect(result.excludedRoots.map((r) => r.path)).toContain(container);
    expect(result.excludedRoots.find((r) => r.path === container)!.reason).toBe(
      'not derived: container of a repo whose worktree list failed',
    );
    expect(result.huskCandidates.filter((h) => h.evidence === 'container-residue')).toEqual([]);
    expect(result.summary.reposUnscannable).toBe(1);
  });

  it('falls through to container-residue for a shapeless `.git` pointer', () => {
    const repo = mkdir('repo');
    const shapeless = mkdir('repo', '.claude', 'worktrees', 'agent-shapeless');
    fs.writeFileSync(path.join(shapeless, '.git'), 'this file has no gitdir line\n', 'utf-8');
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
    expect(result.huskCandidates[0]!.evidence).toBe('container-residue');
  });

  it('falls through to container-residue when the pointer target is not worktree-shaped', () => {
    const repo = mkdir('repo');
    const oddTarget = mkdir('somewhere-else');
    const odd = mkdir('repo', '.claude', 'worktrees', 'agent-odd');
    writeGitdirPointer(odd, oddTarget);
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    const husk = result.huskCandidates.find((h) => h.path === odd)!;
    expect(husk.evidence).toBe('container-residue');
  });

  it('reports a registry-registered directory that is also disk residue on BOTH axes', () => {
    // Registry membership is not protection: `totem sync` having touched a path
    // once says nothing about whether the worktree still exists.
    const repo = mkdir('repo');
    const residue = mkdir('repo', '.claude', 'worktrees', 'agent-registered');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }, { path: residue }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: { [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]) },
          toplevels: { [residue]: repo },
        },
        calls,
      ),
    });
    expect(result.repos.find((r) => r.path === residue)!.notGitRoot).toBe(true);
    expect(result.huskCandidates.map((h) => h.path)).toContain(residue);
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

// ─── Multi-husk totality ────────────────────────────────

describe('accounting totality across a multi-husk estate', () => {
  it('reports every husk and accounts for EVERY enumerated candidate dir', () => {
    const repo = mkdir('repo');
    const container = mkdir('repo', '.claude', 'worktrees');
    const agentA = mkdir('repo', '.claude', 'worktrees', 'agent-a');
    const agentB = mkdir('repo', '.claude', 'worktrees', 'agent-b');
    const liveWt = mkdir('repo', '.claude', 'worktrees', 'live-wt');
    const dangling = mkdir('zzz-dangling');
    writeGitdirPointer(dangling, path.join(root, 'gone', '.git', 'worktrees', 'zzz'));
    const residue = mkdir('repo-residue');
    fs.mkdirSync(path.join(residue, 'node_modules'));
    const plain = mkdir('plain-dir');
    const otherCheckout = mkdir('other-checkout');
    fs.mkdirSync(path.join(otherCheckout, '.git'));
    const nodeModules = mkdir('node_modules');
    const hidden = mkdir('.hidden');

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([
              { path: repo, branch: 'refs/heads/main' },
              { path: liveWt, branch: 'refs/heads/live' },
            ]),
          },
          defaultRefs: { [repo]: 'origin/main' },
        },
        calls,
      ),
    });

    // (i) every husk is reported — a one-husk cap would fail this outright.
    expect(Object.fromEntries(result.huskCandidates.map((h) => [h.path, h.evidence]))).toEqual({
      [agentA]: 'container-residue',
      [agentB]: 'container-residue',
      [dangling]: 'dangling-gitdir-pointer',
      [residue]: 'residue-shape',
    });

    // (ii) totality: enumerate the swept roots' children independently and
    // account for each one. The partition is a SWEEP-AXIS property, so the
    // failure set is built from sweep-source, candidate-keyed rows only — a
    // registry- or worktree-source row lives on a different axis and must never
    // be what satisfies `unaccounted`.
    const classified = new Set(result.worktrees.map((w) => w.path));
    const husks = new Set(result.huskCandidates.map((h) => h.path));
    const failed = new Set(sweepFailures(result));
    for (const p of classified) expect(husks.has(p) || failed.has(p)).toBe(false);
    for (const p of husks) expect(failed.has(p)).toBe(false);

    // This fixture probes cleanly, so the other two axes are empty — asserted
    // rather than assumed, so a future fixture change cannot quietly start
    // leaning on them.
    expect(result.unscannable.filter((u) => u.source !== 'sweep')).toEqual([]);
    expect(rootFailures(result)).toEqual([]);

    const enumerated: string[] = [];
    for (const { path: sweptRoot } of result.sweptRoots) {
      for (const dirent of fs.readdirSync(sweptRoot, { withFileTypes: true })) {
        if (dirent.isDirectory()) enumerated.push(path.join(sweptRoot, dirent.name));
      }
    }
    const unaccounted = enumerated
      .filter((p) => !classified.has(p) && !husks.has(p) && !failed.has(p))
      .sort();

    // Every remaining dir is one of the NAMED exempt shapes, listed explicitly
    // so a newly-dropped candidate fails here instead of vanishing:
    //   .hidden       — dot-dir, never swept
    //   node_modules  — name-excluded
    //   other-checkout— carries a `.git` DIRECTORY (a real checkout)
    //   plain-dir     — no evidence under a STANDARD root
    //   repo          — git-known (its own worktree list names it)
    // `live-wt` is NOT exempt: it is git-known AND lands in the worktrees
    // bucket as a classified row, which the assertion below pins.
    expect(classified.has(liveWt)).toBe(true);
    expect(unaccounted).toEqual([hidden, nodeModules, otherCheckout, plain, repo].sort());
    expect(rootPaths(result)).toEqual([container, root].sort());
  });
});

// ─── Root vs candidate namespace ────────────────────────

/**
 * Can this platform make a directory unreadable via chmod? POSIX yes; Windows
 * maps chmod to the read-only attribute, which does not block `readdir`.
 */
function canBlockReaddir(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-estate-perm-'));
  try {
    fs.chmodSync(probe, 0o000);
    fs.readdirSync(probe);
    return false;
    // totem-context: intentional cleanup — a throw here is the POSITIVE result (the platform blocked the read); the probe dir is removed in the finally below either way.
  } catch {
    return true;
  } finally {
    // totem-context: intentional cleanup — restore permissions before removing the probe dir; a failure to chmod back would only leak one temp dir and must not fail the suite.
    try {
      fs.chmodSync(probe, 0o700);
      fs.rmSync(probe, { recursive: true, force: true });
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      /* probe dir leak is harmless */
    }
  }
}

describe('root-level failures live outside the candidate partition', () => {
  it('keys an unreadable root by the ROOT while its parent still yields a candidate row', () => {
    const parent = mkdir('sweep-parent');
    const child = path.join(parent, 'child-wt');
    fs.mkdirSync(child);

    const blocked = canBlockReaddir();
    if (blocked) fs.chmodSync(child, 0o000);
    try {
      const calls: string[][] = [];
      const result = scanEstate({
        registry: [],
        now: NOW,
        // Both the parent and the child are declared roots. The child is swept
        // as a ROOT (and fails when the platform can block it) while ALSO being
        // an enumerable candidate under the parent.
        extraRoots: [parent, child],
        safeExec: makeExec({ lists: {} }, calls),
      });

      expect(rootPaths(result)).toEqual([child, parent].sort());
      // The candidate row: the child is untracked under a container root.
      expect(result.huskCandidates.map((h) => h.path)).toEqual([child]);

      if (blocked) {
        // The root-failure row is keyed by the same path, on the root namespace.
        const rootRows = rootFailures(result);
        expect(rootRows.map((r) => r.path)).toEqual([child]);
        expect(rootRows[0]!.reason).toContain('sweep root unreadable');
        // Distinguishable from a candidate failure, and EXCLUDED from the
        // partition — otherwise this fixture would read as a double-report.
        expect(sweepFailures(result)).toEqual([]);
      }

      const classified = new Set(result.worktrees.map((w) => w.path));
      const husks = new Set(result.huskCandidates.map((h) => h.path));
      const failed = new Set(sweepFailures(result));
      const all = [...classified, ...husks, ...failed];
      expect(new Set(all).size).toBe(all.length);
    } finally {
      if (blocked) fs.chmodSync(child, 0o700);
    }
  });

  it('keys a nonexistent declared root by the root path, with no candidate row', () => {
    // The portable half of the same property: a root that cannot be read at all
    // produces a root-keyed ledger row and nothing on the candidate axis.
    const gone = path.join(root, 'no-such-root');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [],
      now: NOW,
      extraRoots: [gone],
      safeExec: makeExec({ lists: {} }, calls),
    });
    expect(rootFailures(result).map((r) => r.path)).toEqual([gone]);
    expect(sweepFailures(result)).toEqual([]);
    expect(result.huskCandidates).toEqual([]);
  });
});

// ─── Suppression-reason aggregation ─────────────────────

describe('suppressed roots carry EVERY reason that declined them', () => {
  it('aggregates missing and unverifiable reasons into one disclosure row', () => {
    const nested = path.join(root, 'nested');
    const missing = path.join(nested, 'gone');
    const unverifiable = mkdir('nested', 'maybe-repo');

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: missing }, { path: unverifiable }],
      now: NOW,
      safeExec: makeExec({ lists: {}, failToplevel: [unverifiable] }, calls),
    });

    expect(result.excludedRoots).toHaveLength(1);
    expect(result.excludedRoots[0]!.path).toBe(nested);
    // Both derivations declined this root; reporting only the first would
    // under-state why it is not swept.
    expect(result.excludedRoots[0]!.reason).toBe(
      'not derived: derived from missing registry entry path(s); derived from unverifiable registry entry path(s)',
    );
  });

  it('keeps the tmpdir reason standing alone — it names the escape hatch', () => {
    const underTmp = mkTmpdirChild('totem-estate-tmproot-');
    const missingUnderTmp = path.join(path.resolve(os.tmpdir()), 'totem-estate-not-here');
    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: underTmp }, { path: missingUnderTmp }],
      now: NOW,
      safeExec: makeExec(
        { lists: { [underTmp]: porcelain([{ path: underTmp, branch: 'refs/heads/main' }]) } },
        calls,
      ),
    });
    const row = result.excludedRoots.find((r) => r.path === path.resolve(os.tmpdir()))!;
    expect(row.reason).toBe(
      'os tmpdir — derived only from a registry entry path; pass --root to sweep it',
    );
  });
});

// ─── Bare-repo gitdir layout ────────────────────────────

describe('homeRepoFromGitdir accepts the bare-repo worktree layout', () => {
  it('resolves `<repo>.git/worktrees/<n>` to the `.git`-suffixed repo dir', () => {
    const repo = mkdir('repo');
    const bare = mkdir('bare-mirror.git');
    const gitdir = mkdir('bare-mirror.git', 'worktrees', 'orphan');
    const orphan = mkdir('orphan-wt');
    writeGitdirPointer(orphan, gitdir);

    const calls: string[][] = [];
    const result = scanEstate({
      registry: [{ path: repo }],
      now: NOW,
      safeExec: makeExec(
        {
          lists: {
            [repo]: porcelain([{ path: repo, branch: 'refs/heads/main' }]),
            // The bare mirror still answers, and no longer lists the orphan.
            [bare]: porcelain([{ path: bare, branch: 'refs/heads/main' }]),
          },
        },
        calls,
      ),
    });
    const row = result.huskCandidates.find((h) => h.path === orphan)!;
    expect(row.evidence).toBe('deregistered-intact');
    expect(row.matchedRepo).toBe(bare);
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
      reposNotGitRoot: 0,
      reposUnscannable: 0,
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
    'rev-parse --show-toplevel',
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
      // `--no-optional-locks` is what makes the read-only claim true rather
      // than aspirational: without it `git status` refreshes and WRITES the
      // index, taking index.lock (git-status(1) § BACKGROUND REFRESH). Asserted
      // on EVERY invocation, not just the status ones — a future verb must not
      // be able to opt out silently.
      expect(call[1]).toBe('--no-optional-locks');
      // Every invocation is `git --no-optional-locks -C <path> <verb…>`; the
      // verb is what the allowlist constrains.
      expect(call[2]).toBe('-C');
      const verb = call.slice(4).join(' ');
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
