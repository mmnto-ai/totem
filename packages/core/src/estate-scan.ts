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
 *   - **husk sweep**: the dirname of every registry path and every listed
 *     worktree path (plus caller-supplied roots) is swept one level for
 *     worktree-shaped residue. Positive, typed evidence is REQUIRED — an
 *     unclassifiable directory is not reported at all rather than guessed at.
 *
 * Sensor, never actuator: the only git verbs invoked are `worktree list`,
 * `status`, `merge-base --is-ancestor`, `log -1`, and `rev-parse`; nothing is
 * written, no registry entry is mutated, and nothing is cached across calls.
 * Every probe failure lands as an `unscannable` row (or a class-`unscannable`
 * worktree row naming the failed step) so a degraded scan can never read as a
 * clean one.
 *
 * `safeExec` is injected rather than imported so the scan stays testable
 * without a real git tree (the author-sandbox.ts:21 idiom).
 */

import * as fs from 'node:fs';
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

export type HuskEvidence = 'dangling-gitdir-pointer' | 'residue-shape' | 'deregistered-intact';

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

export interface EstateUnscannableRow {
  path: string;
  reason: string;
}

export interface EstateRepoRow {
  path: string;
  lastSync?: string;
  /** Registry entry whose path no longer exists — reported, never probed. */
  missing?: boolean;
  /** Short default-branch name, absent when underivable (never guessed). */
  defaultBranch?: string;
  /** Count of LINKED worktrees (the main worktree is the repo itself). */
  worktrees: number;
}

export interface EstateSummary {
  repos: number;
  reposMissing: number;
  worktrees: number;
  active: number;
  stale: number;
  indeterminate: number;
  detached: number;
  unscannableWorktrees: number;
  huskCandidates: number;
  unscannable: number;
}

export interface EstateScanResult {
  schemaVersion: typeof ESTATE_SCHEMA_VERSION;
  derivedAt: string;
  /** Every root actually swept — disclosed so no cap or omission is silent. */
  sweptRoots: string[];
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
  if (idx < 1 || parts[idx - 1] !== '.git') return undefined;
  const home = parts.slice(0, idx - 1).join(path.sep);
  return home.length > 0 ? home : undefined;
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
  const registryKeys = new Set<string>();
  /** Folded key → display path, so a root is swept once regardless of casing. */
  const sweepRoots = new Map<string, string>();
  const classifiedKeys = new Set<string>();
  const defaultRefCache = new Map<string, string | undefined>();
  const homeListCache = new Map<string, WorktreeListEntry[] | undefined>();

  const addUnscannable = (p: string, reason: string): void => {
    unscannable.push({ path: p, reason });
  };

  const addSweepRoot = (dir: string): void => {
    const resolved = path.resolve(dir);
    const key = foldCase(resolved);
    if (!sweepRoots.has(key)) sweepRoots.set(key, resolved);
  };

  const git = (cwd: string, args: string[]): string =>
    safeExec('git', ['-C', cwd, ...args], { timeout: GIT_COMMAND_TIMEOUT_MS });

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
      addUnscannable(wtPath, reason);
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
      addUnscannable(wtPath, reason);
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
    registryKeys.add(pathKey(repoPath));
    addSweepRoot(path.dirname(repoPath));
    const lastSyncField = entry.lastSync === undefined ? {} : { lastSync: entry.lastSync };

    if (!isRealDirectory(repoPath)) {
      repos.push({ path: repoPath, ...lastSyncField, missing: true, worktrees: 0 });
      continue;
    }

    let listed: WorktreeListEntry[];
    // totem-context: intentional cleanup — one unreadable repo (moved, corrupt, not a git tree) is recorded as a named unscannable row and the remaining registry entries still scan; a throw here would make one bad entry hide the whole estate.
    try {
      listed = listWorktrees(repoPath);
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      repos.push({ path: repoPath, ...lastSyncField, worktrees: 0 });
      addUnscannable(repoPath, `worktree list --porcelain failed: ${describe(err)}`);
      continue;
    }

    for (const wt of listed) addSweepRoot(path.dirname(path.resolve(wt.path)));

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

  for (const extra of inputs.extraRoots ?? []) addSweepRoot(extra);

  /** Registered repo basenames, for the residue-shape prefix match. */
  const repoBasenames = repos.map((r) => ({
    repoPath: r.path,
    name: foldCase(path.basename(r.path)),
  }));

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

  const classifyHusk = (dir: string, root: string): EstateHuskRow | undefined => {
    const gitEntry = lstatSafe(path.join(dir, '.git'));
    const ageDays = huskAgeDays(dir);
    const ageField = ageDays === undefined ? {} : { ageDays };

    // A `.git` DIRECTORY is an ordinary repo checkout — never a husk.
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
        addUnscannable(dir, `.git pointer unreadable: ${describe(err)}`);
        return undefined;
      }
      // A `.git` file with no `gitdir:` line is shapeless — no typed evidence.
      if (pointer === undefined) return undefined;

      if (!fs.existsSync(pointer)) {
        return { path: dir, sweptRoot: root, evidence: 'dangling-gitdir-pointer', ...ageField };
      }

      const home = homeRepoFromGitdir(pointer);
      if (home === undefined) return undefined;
      const listed = homeWorktreeList(home);
      if (listed === undefined) {
        addUnscannable(dir, `home repo worktree list failed (${home})`);
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

    // No `.git` at all (a symlinked `.git` lands here too and yields no typed
    // evidence): residue-shape needs BOTH a registered-repo name prefix and a
    // leftover `node_modules`.
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

  const sweptRoots = [...sweepRoots.values()].sort();
  for (const root of sweptRoots) {
    let dirents: fs.Dirent[];
    // totem-context: intentional cleanup — an unreadable sweep root (EACCES, raced deletion) is recorded as a named unscannable row so the omission is visible, and the sibling roots still sweep.
    try {
      dirents = fs.readdirSync(root, { withFileTypes: true });
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      addUnscannable(root, `sweep root unreadable: ${describe(err)}`);
      continue;
    }
    for (const dirent of dirents) {
      // `isDirectory()` on a readdir Dirent is lstat-shaped: a symlink or
      // junction answers false, so the sweep never follows one out of the root.
      if (!dirent.isDirectory()) continue;
      if (dirent.name.startsWith('.') || dirent.name === 'node_modules') continue;
      const dir = path.join(root, dirent.name);
      const key = pathKey(dir);
      // Invariant 1: anything git named as a worktree, and any registry repo
      // itself, is never husk-candidate material.
      if (gitKnownPaths.has(key) || registryKeys.has(key)) continue;
      // totem-context: intentional cleanup — a directory that vanishes or turns unreadable mid-sweep (TOCTOU) is recorded as a named unscannable row; one raced entry must not abort the sweep of its siblings.
      try {
        const husk = classifyHusk(dir, root);
        if (husk !== undefined) huskCandidates.push(husk);
        // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
      } catch (err) {
        addUnscannable(dir, `husk probe failed: ${describe(err)}`);
      }
    }
  }

  // ─── Accounting ───────────────────────────────────────

  worktrees.sort(byPath);
  huskCandidates.sort(byPath);
  unscannable.sort(byPath);

  const countClass = (cls: WorktreeClass): number =>
    worktrees.filter((w) => w.class === cls).length;

  return {
    schemaVersion: ESTATE_SCHEMA_VERSION,
    derivedAt: new Date(now).toISOString(),
    sweptRoots,
    repos,
    worktrees,
    huskCandidates,
    unscannable,
    summary: {
      repos: repos.length,
      reposMissing: repos.filter((r) => r.missing === true).length,
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
