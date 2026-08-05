/**
 * Worktree-estate sensor (mmnto-ai/totem#2580 slice-1) — the read-only scan
 * behind `totem doctor --estate`.
 *
 * Two arms, both local-git + local-fs only:
 *   - **registered**: for every repo in the user-level registry, enumerate the
 *     LINKED worktrees (`git worktree list --porcelain`) and classify each one
 *     from evidence — dirty tree → active; clean + ancestry-merged into the
 *     default branch → stale; clean + NOT ancestry-merged → `indeterminate`,
 *     never stale. That last state is the squash-merge gap stated honestly: a
 *     squash-merged branch leaves no ancestry edge, and this sensor has no
 *     merged-facts source (the status-lane snapshot extension is a later
 *     slice), so it declines to claim either way.
 *   - **husk sweep**: candidate roots are swept one level for worktree-shaped
 *     residue. Roots come in two kinds, and the kind decides what counts as
 *     evidence. A CONTAINER root exists solely to hold worktrees
 *     (`<repo>/.claude/worktrees`, or any `--root` the operator names), so an
 *     untracked directory there is residue BY LOCATION. A STANDARD root (the
 *     parent of a registry path or of a listed worktree) is an ordinary
 *     working directory, so residue there needs the older positive evidence —
 *     a dangling `.git` pointer, or a repo-name prefix plus a leftover
 *     `node_modules`. Either way an unclassifiable directory is not reported
 *     at all rather than guessed at.
 *
 * Registry membership is NOT protection from candidacy. Git's own worktree
 * list is what protects a path (cohort-overlay §2), and a genuine repo
 * checkout is already protected by the `.git`-DIRECTORY rule; a registry entry
 * only records that something was synced from a path once. Registry accounting
 * and disk residue are different axes — the same path can carry both a repo
 * row and a husk row.
 *
 * Sensor, never actuator: the only git verbs invoked are `worktree list`,
 * `status`, `merge-base --is-ancestor`, `log -1`, and `rev-parse`, and every
 * invocation carries `--no-optional-locks`. That flag is what makes the
 * read-only claim true rather than aspirational: `git status` otherwise
 * refreshes and WRITES the index, taking `index.lock` (git-status(1) §
 * BACKGROUND REFRESH), which in a cohort's shared worktrees would collide with
 * a seat's live `git add`. No registry entry is mutated and nothing is cached
 * across calls. Every probe failure lands as an `unscannable` row (or a
 * class-`unscannable` worktree row naming the failed step) so a degraded scan
 * can never read as a clean one.
 *
 * `safeExec` is injected rather than imported so the scan stays testable
 * without a real git tree (the author-sandbox.ts:21 idiom).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { SafeExecErrorFields, SafeExecOptions } from './sys/exec.js';

// ─── Constants ──────────────────────────────────────────

/** The compatibility contract with the status-lane consumer of `--estate --json`. */
export const ESTATE_SCHEMA_VERSION = 1;

const GIT_COMMAND_TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;

/**
 * `git merge-base --is-ancestor` answers via exit code: 0 = ancestor, 1 = not
 * an ancestor. Any OTHER status is a real failure (bad ref, corrupt object
 * store) and must NOT be read as "not merged".
 */
const NOT_AN_ANCESTOR_EXIT = 1;

// ─── Types ──────────────────────────────────────────────

/**
 * The injected exec seam. Structurally identical to `safeExec`, so production
 * callers pass it directly and tests pass a spy.
 */
export type EstateExecFn = (command: string, args?: string[], options?: SafeExecOptions) => string;

/** One entry of `git worktree list --porcelain`. */
export interface WorktreeListEntry {
  path: string;
  /** Commit at the worktree's HEAD, when git reported one. */
  head?: string;
  /** Full ref (`refs/heads/<name>`) — absent for a detached or bare entry. */
  branch?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  lockedReason?: string;
  prunable: boolean;
  prunableReason?: string;
}

export type WorktreeClass =
  | 'registered-active'
  | 'registered-stale'
  | 'registered-indeterminate'
  | 'registered-detached'
  | 'unscannable';

export type HuskEvidence =
  | 'dangling-gitdir-pointer'
  | 'residue-shape'
  | 'deregistered-intact'
  /** Untracked directory under a CONTAINER root — the location is the evidence. */
  | 'container-residue';

export interface EstateWorktreeRow {
  path: string;
  /** The registry repo whose worktree list produced this row. */
  repoPath: string;
  /** Short branch name (`refs/heads/` stripped) for display. */
  branch?: string;
  head?: string;
  class: WorktreeClass;
  dirty?: boolean;
  /**
   * `true`/`false` only when the ancestry probe actually ran and answered;
   * `'unknown'` whenever it could not (detached, dirty, no default branch).
   */
  ancestryMerged: boolean | 'unknown';
  /** Days since the worktree's last commit. Absent when `log -1` did not answer. */
  ageDays?: number;
  locked?: boolean;
  prunable?: boolean;
  /** What the classification was read from, in the scan's own words. */
  evidence: string;
}

export interface EstateHuskRow {
  path: string;
  sweptRoot: string;
  evidence: HuskEvidence;
  /** The registry repo (residue-shape) or home repo (deregistered-intact) this matched. */
  matchedRepo?: string;
  /** Days since the directory's mtime — a husk has no commit to date from. */
  ageDays?: number;
}

/**
 * Which AXIS a probe failure belongs to. The sweep axis is the one the
 * candidate partition is defined over; `registry` and `worktree` rows are
 * accounting for the registered arm and may legitimately share a path with a
 * husk row (the two-axes rule — a directory can be both a stale registry entry
 * and disk residue).
 */
export type EstateUnscannableSource = 'registry' | 'worktree' | 'sweep';

export interface EstateUnscannableRow {
  path: string;
  reason: string;
  source: EstateUnscannableSource;
}

export interface EstateRepoRow {
  path: string;
  lastSync?: string;
  /** Registry entry whose path no longer exists — reported, never probed. */
  missing?: boolean;
  /**
   * Registry entry that exists but is NOT a git toplevel: git discovered an
   * ANCESTOR repo from it. Such an entry is never enumerated as a repo (its
   * worktree list would be the ancestor's), and nothing is derived from it.
   */
  notGitRoot?: boolean;
  /** The ancestor repo git discovered — set with `notGitRoot`. */
  enclosingRepo?: string;
  /** Short default-branch name in remote-tracking form (`origin/<name>`), absent when underivable (never guessed). */
  defaultBranch?: string;
  /** Count of LINKED worktrees (the main worktree is the repo itself). */
  worktrees: number;
}

export interface EstateSummary {
  repos: number;
  reposMissing: number;
  /** Registry entries that exist but are not a git toplevel. */
  reposNotGitRoot: number;
  /** Registry entries whose own probes failed (registry-source ledger rows). */
  reposUnscannable: number;
  worktrees: number;
  active: number;
  stale: number;
  indeterminate: number;
  detached: number;
  unscannableWorktrees: number;
  huskCandidates: number;
  unscannable: number;
}

/** A root the derivation declined to sweep, with the reason it was declined. */
export interface EstateExcludedRoot {
  path: string;
  reason: string;
}

/**
 * A swept root and its KIND, which is what decides the evidence bar inside it:
 * a `container` root is a declared worktree location (location is evidence), a
 * `standard` root is an ordinary working directory (shape is evidence).
 * Disclosed so a consumer can tell which bar produced a given husk row.
 */
export interface EstateSweptRoot {
  path: string;
  kind: 'container' | 'standard';
}

export interface EstateScanResult {
  schemaVersion: typeof ESTATE_SCHEMA_VERSION;
  derivedAt: string;
  /**
   * Every root actually swept, with its kind — disclosed so no cap, omission,
   * or evidence-bar difference is silent.
   */
  sweptRoots: EstateSweptRoot[];
  /**
   * Roots the derivation suppressed, so the narrowing is visible rather than
   * silent. A root that any other derivation path also produced is SWEPT and
   * never appears here.
   */
  excludedRoots: EstateExcludedRoot[];
  repos: EstateRepoRow[];
  worktrees: EstateWorktreeRow[];
  huskCandidates: EstateHuskRow[];
  unscannable: EstateUnscannableRow[];
  summary: EstateSummary;
}

/** The registry projection the scan needs — nothing else is read from it. */
export interface EstateRegistryEntry {
  path: string;
  lastSync?: string;
}

export interface EstateScanInputs {
  registry: EstateRegistryEntry[];
  safeExec: EstateExecFn;
  /** Epoch ms, injected so `ageDays` is deterministic under test. */
  now: number;
  /** Extra sweep roots (`--root`, repeatable), unioned with the derived ones. */
  extraRoots?: string[];
}

// ─── Porcelain parser ───────────────────────────────────

/**
 * Parse `git worktree list --porcelain`: one `worktree <path>` header per
 * entry, attribute lines until a blank line. Unknown attributes are ignored so
 * a newer git cannot break the parse. Git lists the MAIN worktree first,
 * followed by the linked ones — callers depend on that order.
 */
export function parseWorktreeListPorcelain(raw: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = [];
  let current: WorktreeListEntry | undefined;

  const flush = (): void => {
    if (current !== undefined) entries.push(current);
    current = undefined;
  };

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      flush();
      continue;
    }
    const sep = line.indexOf(' ');
    const key = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? '' : line.slice(sep + 1).trim();

    if (key === 'worktree') {
      flush();
      current = { path: value, bare: false, detached: false, locked: false, prunable: false };
      continue;
    }
    // An attribute before any header is malformed output; drop it rather than
    // inventing an entry with no path.
    if (current === undefined) continue;

    switch (key) {
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        current.branch = value;
        break;
      case 'bare':
        current.bare = true;
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        if (value.length > 0) current.lockedReason = value;
        break;
      case 'prunable':
        current.prunable = true;
        if (value.length > 0) current.prunableReason = value;
        break;
      default:
        break;
    }
  }
  flush();
  return entries;
}

// ─── Local helpers ──────────────────────────────────────

/**
 * Windows git and Node can disagree on drive-letter case (GCA #2293), which
 * would let a live worktree double-report as a husk. Fold on win32 ONLY —
 * POSIX filesystems are case-sensitive and folding there conflates real paths.
 */
function foldCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function pathKey(p: string): string {
  return foldCase(path.resolve(p));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** No-follow directory probe: a symlinked/junctioned path is not a directory here. */
function isRealDirectory(p: string): boolean {
  // totem-context: intentional cleanup — an ENOENT/EACCES lstat degrades to "not a directory", matching the sweep's skip-don't-abort posture (mail.ts:406 idiom).
  try {
    return fs.lstatSync(p).isDirectory();
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    return false;
  }
}

function lstatSafe(p: string): fs.Stats | undefined {
  // totem-context: intentional cleanup — a missing or unreadable `.git` entry is an ordinary sweep outcome; the caller decides which evidence arm (if any) applies.
  try {
    return fs.lstatSync(p);
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    return undefined;
  }
}

/**
 * The home repo a linked worktree's `gitdir:` points into:
 * `<repo>/.git/worktrees/<name>` → `<repo>`. Returns undefined when the target
 * is not worktree-shaped (no typed evidence, so no husk row).
 */
function homeRepoFromGitdir(target: string): string | undefined {
  const parts = target.split(/[\\/]/);
  const idx = parts.lastIndexOf('worktrees');
  if (idx < 1) return undefined;
  const parent = parts[idx - 1]!;
  // Standard layout: `<repo>/.git/worktrees/<n>` — the repo is above `.git`.
  // Bare layout: `<repo>.git/worktrees/<n>` — the `.git`-suffixed directory IS
  // the repo, so it stays in the path.
  const home =
    parent === '.git'
      ? parts.slice(0, idx - 1).join(path.sep)
      : parent.endsWith('.git')
        ? parts.slice(0, idx).join(path.sep)
        : undefined;
  return home !== undefined && home.length > 0 ? home : undefined;
}

function shortBranchName(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

function byPath<T extends { path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

// ─── Scan ───────────────────────────────────────────────

/**
 * Scan the worktree estate. Pure per invocation: nothing persists, nothing is
 * written, and the result is the complete accounting — every enumerated
 * candidate is either classified, a husk candidate, or `unscannable`.
 */
export function scanEstate(inputs: EstateScanInputs): EstateScanResult {
  const { registry, safeExec, now } = inputs;

  const repos: EstateRepoRow[] = [];
  const worktrees: EstateWorktreeRow[] = [];
  const huskCandidates: EstateHuskRow[] = [];
  const unscannable: EstateUnscannableRow[] = [];

  /** Every path git has named as a worktree — invariant 1's never-a-husk set. */
  const gitKnownPaths = new Set<string>();
  /** Folded key → root, so a root is swept once regardless of casing. */
  const sweepRoots = new Map<string, { path: string; container: boolean }>();
  /** Suppressed roots, filtered at the end against what actually got swept. */
  const classifiedKeys = new Set<string>();
  const defaultRefCache = new Map<string, string | undefined>();
  const homeListCache = new Map<string, WorktreeListEntry[] | undefined>();

  /** Registry entries that probed clean AND enumerated — the attribution targets. */
  const verifiedRepos: string[] = [];
  let reposUnscannable = 0;

  const addUnscannable = (p: string, reason: string, source: EstateUnscannableSource): void => {
    unscannable.push({ path: p, reason, source });
  };

  /**
   * Register a sweep root. `container` marks a root that exists SOLELY to hold
   * worktrees, which is what licenses the by-location `container-residue`
   * class. A root reached by both kinds is a container: the more specific
   * declaration wins.
   */
  const addSweepRoot = (dir: string, container: boolean): void => {
    const resolved = path.resolve(dir);
    const key = foldCase(resolved);
    const existing = sweepRoots.get(key);
    if (existing === undefined) sweepRoots.set(key, { path: resolved, container });
    else if (container) existing.container = true;
  };

  /**
   * True for the OS temp dir. Compared against both the reported path and its
   * realpath, because macOS reports `/var/folders/...` while every real path
   * under it resolves through `/private/var` (either form must match).
   */
  const isOsTmpdir = (resolved: string): boolean => {
    const folded = foldCase(resolved);
    if (folded === foldCase(path.resolve(os.tmpdir()))) return true;
    // totem-context: intentional cleanup — a temp dir that cannot be realpath'd (unusual TMPDIR, permissions) simply falls back to the lexical comparison above; the exclusion is a heuristic narrowing, not a correctness gate.
    try {
      return folded === foldCase(fs.realpathSync(os.tmpdir()));
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      return false;
    }
  };

  const TMPDIR_SUPPRESSION =
    'os tmpdir — derived only from a registry entry path; pass --root to sweep it';

  /** Every reason that suppressed a given root, folded key → reason set. */
  const suppressionReasons = new Map<string, { path: string; reasons: Set<string> }>();

  /**
   * Record a root the derivation declined to produce, so the narrowing is
   * disclosed rather than silent. Reasons AGGREGATE: a root can be reached (and
   * declined) by several derivations, and reporting only the first would
   * under-state why it is not swept. The tmpdir reason still stands alone
   * because it names the `--root` escape hatch, which the others do not. The
   * end-filter drops any root that some OTHER derivation did produce — a swept
   * root is never reported here.
   */
  const noteSuppressedRoot = (dir: string, reason: string): void => {
    const resolved = path.resolve(dir);
    const key = foldCase(resolved);
    if (isOsTmpdir(resolved)) {
      suppressionReasons.set(key, { path: resolved, reasons: new Set([TMPDIR_SUPPRESSION]) });
      return;
    }
    const existing = suppressionReasons.get(key);
    // A tmpdir suppression already recorded for this root outranks the rest.
    if (existing?.reasons.has(TMPDIR_SUPPRESSION) === true) return;
    if (existing === undefined) {
      suppressionReasons.set(key, { path: resolved, reasons: new Set([reason]) });
    } else {
      existing.reasons.add(reason);
    }
  };

  /**
   * Sweep roots derived from a REGISTRY entry's parent — the weakest of the
   * derivations: a registry entry only proves a repo was synced from that path,
   * not that its parent is a place worktrees live. The OS temp dir is excluded
   * on that basis; entries there are near-always fixture pollution, and
   * sweeping it mints `residue-shape` rows for any tool's `<repo>-*` scratch
   * dir that happens to carry a `node_modules`.
   *
   * The exclusion is scoped to THIS derivation. A listed worktree's parent is
   * positive evidence that worktrees live there, and `--root` is an explicit
   * instruction; either one sweeps the temp dir, and the suppression is then
   * dropped from the disclosure.
   */
  const addRegistryDerivedRoot = (dir: string): void => {
    const resolved = path.resolve(dir);
    if (isOsTmpdir(resolved)) {
      noteSuppressedRoot(resolved, TMPDIR_SUPPRESSION);
      return;
    }
    addSweepRoot(resolved, false);
  };

  // `--no-optional-locks` on EVERY invocation: `git status` otherwise refreshes
  // and writes the index, taking `index.lock` (git-status(1) § BACKGROUND
  // REFRESH). A sensor that runs from the ambient `totem doctor` row must not
  // race a seat's live `git add` in a shared worktree.
  const git = (cwd: string, args: string[]): string =>
    safeExec('git', ['--no-optional-locks', '-C', cwd, ...args], {
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });

  const listWorktrees = (repoPath: string): WorktreeListEntry[] => {
    const entries = parseWorktreeListPorcelain(git(repoPath, ['worktree', 'list', '--porcelain']));
    for (const entry of entries) gitKnownPaths.add(pathKey(entry.path));
    return entries;
  };

  /**
   * The default-branch ref used as the ancestry target. The remote-tracking
   * form (`origin/main`) is used verbatim because a linked worktree need not
   * have the local branch checked out anywhere. Underivable → undefined; the
   * branch name is NEVER guessed (a wrong guess would mint false `stale` rows).
   */
  const defaultRef = (repoPath: string): string | undefined => {
    const key = pathKey(repoPath);
    const cached = defaultRefCache.get(key);
    if (cached !== undefined || defaultRefCache.has(key)) return cached;
    let ref: string | undefined;
    // totem-context: intentional cleanup — a repo with no `origin/HEAD` (no remote, never `set-head`) leaves the default branch underivable; the caller degrades to `ancestryMerged: 'unknown'` rather than guessing a branch name.
    try {
      const out = git(repoPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).trim();
      ref = out.length > 0 && !out.includes('\n') ? out : undefined;
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      ref = undefined;
    }
    defaultRefCache.set(key, ref);
    return ref;
  };

  /** Days since the worktree's last commit; undefined when `log -1` did not answer. */
  const lastCommitAgeDays = (wtPath: string): number | undefined => {
    // totem-context: intentional cleanup — an unborn branch or unreadable object store yields no commit date; the row still classifies and its evidence names the missing age (no silent age of 0).
    try {
      const seconds = Number.parseInt(git(wtPath, ['log', '-1', '--format=%ct']).trim(), 10);
      if (!Number.isFinite(seconds)) return undefined;
      return Math.max(0, Math.floor((now - seconds * 1000) / MS_PER_DAY));
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      return undefined;
    }
  };

  const isAncestor = (
    repoPath: string,
    ref: string,
    target: string,
  ): boolean | { error: string } => {
    // totem-context: intentional cleanup — `merge-base --is-ancestor` ANSWERS by exit code, so a non-zero exit is the result, not a failure; exit 1 is returned as `false` and every other status is surfaced to the caller as a named unscannable reason.
    try {
      git(repoPath, ['merge-base', '--is-ancestor', ref, target]);
      return true;
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      const status = (err as Error & SafeExecErrorFields).status;
      if (status === NOT_AN_ANCESTOR_EXIT) return false;
      return { error: describe(err) };
    }
  };

  const classify = (
    repoPath: string,
    entry: WorktreeListEntry,
    target: string | undefined,
  ): EstateWorktreeRow => {
    const wtPath = path.resolve(entry.path);
    const base = {
      path: wtPath,
      repoPath,
      ...(entry.branch !== undefined ? { branch: shortBranchName(entry.branch) } : {}),
      ...(entry.head !== undefined ? { head: entry.head } : {}),
      ...(entry.locked ? { locked: true } : {}),
      ...(entry.prunable ? { prunable: true } : {}),
    };

    let dirty: boolean;
    // totem-context: intentional cleanup — a failed status probe becomes a class-`unscannable` row plus a named failure entry, so the degraded worktree is reported rather than dropped; throwing would abort the scan of every OTHER worktree.
    try {
      dirty = git(wtPath, ['status', '--porcelain']).trim().length > 0;
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      const reason = `status --porcelain failed: ${describe(err)}`;
      addUnscannable(wtPath, reason, 'worktree');
      return { ...base, class: 'unscannable', ancestryMerged: 'unknown', evidence: reason };
    }

    const ageDays = lastCommitAgeDays(wtPath);
    const age =
      ageDays === undefined ? 'last-commit age unavailable' : `last commit ${ageDays}d ago`;
    const ageField = ageDays === undefined ? {} : { ageDays };

    if (entry.detached) {
      return {
        ...base,
        ...ageField,
        class: 'registered-detached',
        dirty,
        ancestryMerged: 'unknown',
        evidence: `detached HEAD, ${dirty ? 'dirty' : 'clean'} tree, ${age} — no branch to test ancestry against`,
      };
    }

    if (dirty) {
      return {
        ...base,
        ...ageField,
        class: 'registered-active',
        dirty: true,
        ancestryMerged: 'unknown',
        evidence: `dirty working tree, ${age} — in use, merge state not probed`,
      };
    }

    if (entry.branch === undefined || target === undefined) {
      const why =
        entry.branch === undefined
          ? 'no branch reported by git'
          : 'default branch underivable (no origin/HEAD)';
      return {
        ...base,
        ...ageField,
        class: 'registered-indeterminate',
        dirty: false,
        ancestryMerged: 'unknown',
        evidence: `clean tree, ${age}, ancestry not testable: ${why}`,
      };
    }

    const ancestry = isAncestor(repoPath, entry.branch, target);
    if (typeof ancestry !== 'boolean') {
      const reason = `merge-base --is-ancestor failed: ${ancestry.error}`;
      addUnscannable(wtPath, reason, 'worktree');
      return {
        ...base,
        ...ageField,
        class: 'unscannable',
        ancestryMerged: 'unknown',
        evidence: reason,
      };
    }
    if (ancestry) {
      return {
        ...base,
        ...ageField,
        class: 'registered-stale',
        dirty: false,
        ancestryMerged: true,
        evidence: `clean tree, ${age}, branch is an ancestor of ${target}`,
      };
    }
    return {
      ...base,
      ...ageField,
      class: 'registered-indeterminate',
      dirty: false,
      ancestryMerged: false,
      evidence: `clean tree, ${age}, branch is NOT an ancestor of ${target} — squash-merged branches look identical to unmerged ones from ancestry alone`,
    };
  };

  // ─── Registered arm ───────────────────────────────────

  for (const entry of registry) {
    const repoPath = path.resolve(entry.path);
    const lastSyncField = entry.lastSync === undefined ? {} : { lastSync: entry.lastSync };

    // A missing entry contributes its `missing: true` row and nothing else: a
    // path that no longer exists is no evidence at all about its parent, and
    // deriving a sweep root from it would let stale registry entries drag
    // unrelated directories into the sweep.
    if (!isRealDirectory(repoPath)) {
      repos.push({ path: repoPath, ...lastSyncField, missing: true, worktrees: 0 });
      noteSuppressedRoot(path.dirname(repoPath), 'derived from missing registry entry path(s)');
      continue;
    }

    // Toplevel verification before anything is derived FROM the entry. `git -C
    // <dir>` silently discovers an ANCESTOR repo, so a registry path that is
    // merely INSIDE a repo would otherwise report the ancestor's worktree list
    // as its own and drag the ancestor's neighbourhood into the sweep.
    let toplevel: string;
    // totem-context: intentional cleanup — a failed toplevel probe is recorded as a named unscannable row and the remaining registry entries still scan, matching the worktree-list failure path below.
    try {
      toplevel = git(repoPath, ['rev-parse', '--show-toplevel']).trim();
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      // An entry that cannot be VERIFIED derives nothing, exactly as an entry
      // verified to be a non-root derives nothing: without the toplevel answer
      // there is no evidence this path is a repo at all, so its parent is a
      // guess. Suppressed and disclosed rather than swept.
      repos.push({ path: repoPath, ...lastSyncField, worktrees: 0 });
      addUnscannable(repoPath, `rev-parse --show-toplevel failed: ${describe(err)}`, 'registry');
      reposUnscannable += 1;
      noteSuppressedRoot(
        path.dirname(repoPath),
        'derived from unverifiable registry entry path(s)',
      );
      continue;
    }

    if (pathKey(toplevel) !== pathKey(repoPath)) {
      // Nothing is derived from this entry — not its dirname, and above all not
      // git's answer, which describes the ancestor rather than the entry.
      repos.push({
        path: repoPath,
        ...lastSyncField,
        notGitRoot: true,
        enclosingRepo: path.resolve(toplevel),
        worktrees: 0,
      });
      noteSuppressedRoot(
        path.dirname(repoPath),
        'derived from non-git-root registry entry path(s)',
      );
      continue;
    }

    addRegistryDerivedRoot(path.dirname(repoPath));

    const container = path.join(repoPath, '.claude', 'worktrees');

    let listed: WorktreeListEntry[];
    // totem-context: intentional cleanup — one unreadable repo (moved, corrupt, not a git tree) is recorded as a named unscannable row and the remaining registry entries still scan; a throw here would make one bad entry hide the whole estate.
    try {
      listed = listWorktrees(repoPath);
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      repos.push({ path: repoPath, ...lastSyncField, worktrees: 0 });
      addUnscannable(repoPath, `worktree list --porcelain failed: ${describe(err)}`, 'registry');
      reposUnscannable += 1;
      // The container root is WITHDRAWN when the repo's worktree list failed.
      // Container-residue is a by-location claim that only holds against a
      // known set of live worktrees; without that list every live worktree in
      // the container would read as residue. A degraded scan must never report
      // DIRTIER than a healthy one.
      if (isRealDirectory(container)) {
        noteSuppressedRoot(container, 'container of a repo whose worktree list failed');
      }
      continue;
    }

    // A CONTAINER root, added only once the repo's live worktrees are known:
    // this directory exists solely to hold worktrees, so an untracked directory
    // inside it is residue by location alone.
    if (isRealDirectory(container)) addSweepRoot(container, true);
    verifiedRepos.push(repoPath);

    for (const wt of listed) {
      // The listed entry that IS the registry path carries no evidence beyond
      // the registry entry itself, so its parent stays on the registry-derived
      // path (otherwise the weakest derivation would launder itself through
      // git's own output). Every OTHER listed worktree is positive evidence
      // that worktrees live in that parent.
      const parent = path.dirname(path.resolve(wt.path));
      if (pathKey(wt.path) === pathKey(repoPath)) addRegistryDerivedRoot(parent);
      else addSweepRoot(parent, false);
    }

    // Git lists the main worktree first; it IS the repo, not estate residue, so
    // only the linked worktrees are classified. Its path still joined the
    // never-a-husk set above.
    const linked = listed.slice(1);
    const target = defaultRef(repoPath);
    repos.push({
      path: repoPath,
      ...lastSyncField,
      ...(target === undefined ? {} : { defaultBranch: shortBranchName(target) }),
      worktrees: linked.length,
    });

    for (const wt of linked) {
      // Two registry entries can resolve to the same repo (a repo and one of
      // its own worktrees both registered) — classify each path once so the
      // summary counts stay equal to the row counts.
      const key = pathKey(wt.path);
      if (classifiedKeys.has(key)) continue;
      classifiedKeys.add(key);
      worktrees.push(classify(repoPath, wt, target));
    }
  }

  // ─── Husk sweep ───────────────────────────────────────

  // An operator naming a root with `--root` is DECLARING a worktree location,
  // which is the same claim `<repo>/.claude/worktrees` makes structurally.
  for (const extra of inputs.extraRoots ?? []) addSweepRoot(extra, true);

  /**
   * Attribution targets for the residue-shape prefix match: VERIFIED repos
   * only. A missing, not-git-root, or unprobeable entry is not a repo this scan
   * can vouch for, and letting one attribute would let a husk name ITSELF as
   * the repo it is residue of. Sorted longest-name first so attribution takes
   * the most specific repo: with both `totem` and `totem-strategy` verified,
   * `totem-strategy-claude-x` must name `totem-strategy`.
   */
  const repoBasenames = verifiedRepos
    .map((repoPath) => ({ repoPath, name: foldCase(path.basename(repoPath)) }))
    .sort((a, b) => b.name.length - a.name.length);

  const huskAgeDays = (dir: string): number | undefined => {
    // totem-context: intentional cleanup — a husk has no commit history, so mtime is the only available age; an unreadable stat drops the field rather than reporting a fabricated age.
    try {
      return Math.max(0, Math.floor((now - fs.statSync(dir).mtimeMs) / MS_PER_DAY));
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      return undefined;
    }
  };

  const homeWorktreeList = (home: string): WorktreeListEntry[] | undefined => {
    const key = pathKey(home);
    if (homeListCache.has(key)) return homeListCache.get(key);
    let listed: WorktreeListEntry[] | undefined;
    // totem-context: intentional cleanup — the home repo of a `.git` pointer may itself be gone or unreadable; the caller records the directory as unscannable rather than asserting husk-ness it cannot prove.
    try {
      listed = listWorktrees(home);
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      listed = undefined;
    }
    homeListCache.set(key, listed);
    return listed;
  };

  const classifyHusk = (
    dir: string,
    root: string,
    container: boolean,
  ): EstateHuskRow | undefined => {
    const gitEntry = lstatSafe(path.join(dir, '.git'));
    const ageDays = huskAgeDays(dir);
    const ageField = ageDays === undefined ? {} : { ageDays };

    /**
     * Under a CONTAINER root the by-location claim still stands when the
     * `.git`-FILE arm produces no TYPED outcome (a pointer with no `gitdir:`
     * line, or a target that is not worktree-shaped): git tracks no worktree
     * here and the directory sits in a place that exists only to hold
     * worktrees. Under a STANDARD root the same shapelessness means no
     * evidence at all.
     */
    const containerFallback = (): EstateHuskRow | undefined =>
      container
        ? { path: dir, sweptRoot: root, evidence: 'container-residue', ...ageField }
        : undefined;

    // A `.git` DIRECTORY is an ordinary repo checkout — never a husk, under any
    // root kind.
    if (gitEntry?.isDirectory() === true) return undefined;

    if (gitEntry?.isFile() === true) {
      let pointer: string | undefined;
      // totem-context: intentional cleanup — an unreadable `.git` pointer is recorded as a named unscannable row: the directory cannot be proven a husk, and guessing either way is exactly what the evidence-typed classification exists to prevent.
      try {
        const raw = fs.readFileSync(path.join(dir, '.git'), 'utf-8');
        const match = /^gitdir:\s*(.+)$/m.exec(raw);
        pointer = match === null ? undefined : path.resolve(dir, match[1]!.trim());
        // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
      } catch (err) {
        addUnscannable(dir, `.git pointer unreadable: ${describe(err)}`, 'sweep');
        return undefined;
      }
      // A `.git` file with no `gitdir:` line is shapeless — no typed evidence
      // under a STANDARD root; under a CONTAINER root the location still is.
      if (pointer === undefined) return containerFallback();

      if (!fs.existsSync(pointer)) {
        return { path: dir, sweptRoot: root, evidence: 'dangling-gitdir-pointer', ...ageField };
      }

      const home = homeRepoFromGitdir(pointer);
      if (home === undefined) return containerFallback();
      const listed = homeWorktreeList(home);
      if (listed === undefined) {
        addUnscannable(dir, `home repo worktree list failed (${home})`, 'sweep');
        return undefined;
      }
      // The home repo still tracks it: a live worktree of an unregistered repo,
      // not residue.
      if (listed.some((e) => pathKey(e.path) === pathKey(dir))) return undefined;
      return {
        path: dir,
        sweptRoot: root,
        evidence: 'deregistered-intact',
        matchedRepo: home,
        ...ageField,
      };
    }

    // No `.git` at all, or a `.git` that is neither file nor directory.
    if (gitEntry === undefined && !isRealDirectory(dir)) {
      // The directory readdir named is gone or unreadable by the time we probe
      // it — a raced scan must report the hole, not silently drop the entry.
      addUnscannable(dir, 'vanished or turned unreadable mid-sweep', 'sweep');
      return undefined;
    }

    // Under a CONTAINER root the location IS the evidence: these roots exist
    // solely to hold worktrees, so a directory git does not track is residue
    // without needing a name or a `node_modules`. The stronger `.git`-FILE
    // classes above still win when they apply.
    if (container) {
      return { path: dir, sweptRoot: root, evidence: 'container-residue', ...ageField };
    }

    // Under a STANDARD root — an ordinary working directory — residue-shape
    // needs BOTH a registered-repo name prefix and a leftover `node_modules`.
    // A symlinked `.git` yields no typed evidence here.
    if (gitEntry !== undefined) return undefined;
    const name = foldCase(path.basename(dir));
    const matched = repoBasenames.find((r) => r.name.length > 0 && name.startsWith(r.name));
    if (matched === undefined) return undefined;
    if (!isRealDirectory(path.join(dir, 'node_modules'))) return undefined;
    return {
      path: dir,
      sweptRoot: root,
      evidence: 'residue-shape',
      matchedRepo: matched.repoPath,
      ...ageField,
    };
  };

  const roots = [...sweepRoots.values()].sort(byPath);
  const sweptRoots: EstateSweptRoot[] = roots.map((r) => ({
    path: r.path,
    kind: r.container ? 'container' : 'standard',
  }));
  for (const { path: root, container } of roots) {
    let dirents: fs.Dirent[];
    // totem-context: intentional cleanup — an unreadable sweep root (EACCES, raced deletion) is recorded as a named unscannable row so the omission is visible, and the sibling roots still sweep.
    try {
      dirents = fs.readdirSync(root, { withFileTypes: true });
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      // Keyed by the ROOT, not by a candidate. Root-level failures live outside
      // the candidate partition: the same path can legitimately be a failed
      // root here AND a candidate row under its own parent when that parent is
      // also swept. Partition assertions therefore exclude ledger rows whose
      // path equals a swept root.
      addUnscannable(root, `sweep root unreadable: ${describe(err)}`, 'sweep');
      continue;
    }
    for (const dirent of dirents) {
      // `isDirectory()` on a readdir Dirent is lstat-shaped: a symlink or
      // junction answers false, so the sweep never follows one out of the root.
      if (!dirent.isDirectory()) continue;
      if (dirent.name.startsWith('.') || dirent.name === 'node_modules') continue;
      const dir = path.join(root, dirent.name);
      // Invariant 1: what protects a path from candidacy is GIT's worktree
      // list (cohort-overlay §2) — plus the `.git`-DIRECTORY rule inside
      // classifyHusk, which covers every genuine repo checkout. Registry
      // membership is deliberately NOT protection: registry accounting and
      // disk residue are different axes, so one path may carry both a repo row
      // and a husk row.
      if (gitKnownPaths.has(pathKey(dir))) continue;
      // totem-context: intentional cleanup — a directory that vanishes or turns unreadable mid-sweep (TOCTOU) is recorded as a named unscannable row; one raced entry must not abort the sweep of its siblings.
      try {
        const husk = classifyHusk(dir, root, container);
        if (husk !== undefined) huskCandidates.push(husk);
        // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
      } catch (err) {
        addUnscannable(dir, `husk probe failed: ${describe(err)}`, 'sweep');
      }
    }
  }

  // ─── Accounting ───────────────────────────────────────

  worktrees.sort(byPath);
  huskCandidates.sort(byPath);
  unscannable.sort(byPath);

  // A suppression only stands if NO other derivation reached the same root:
  // worktree-parent and `--root` both outrank the registry-dirname exclusion,
  // and a swept root must never also be reported as excluded. Excluded roots
  // are a derivation disclosure, not part of the candidate partition. Every
  // reason that declined the root is carried, sorted so the disclosure is
  // stable across runs.
  const excludedRoots: EstateExcludedRoot[] = [...suppressionReasons]
    .filter(([key]) => !sweepRoots.has(key))
    .map(([, row]) => {
      const reasons = [...row.reasons].sort();
      return {
        path: row.path,
        reason:
          reasons.length === 1 && reasons[0] === TMPDIR_SUPPRESSION
            ? TMPDIR_SUPPRESSION
            : `not derived: ${reasons.join('; ')}`,
      };
    })
    .sort(byPath);

  const countClass = (cls: WorktreeClass): number =>
    worktrees.filter((w) => w.class === cls).length;

  return {
    schemaVersion: ESTATE_SCHEMA_VERSION,
    derivedAt: new Date(now).toISOString(),
    sweptRoots,
    excludedRoots,
    repos,
    worktrees,
    huskCandidates,
    unscannable,
    summary: {
      repos: repos.length,
      reposMissing: repos.filter((r) => r.missing === true).length,
      reposNotGitRoot: repos.filter((r) => r.notGitRoot === true).length,
      reposUnscannable,
      worktrees: worktrees.length,
      active: countClass('registered-active'),
      stale: countClass('registered-stale'),
      indeterminate: countClass('registered-indeterminate'),
      detached: countClass('registered-detached'),
      unscannableWorktrees: countClass('unscannable'),
      huskCandidates: huskCandidates.length,
      unscannable: unscannable.length,
    },
  };
}
