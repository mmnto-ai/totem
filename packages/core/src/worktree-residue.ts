/**
 * Verified residue deletion — the finish `git worktree remove` does not do
 * (mmnto-ai/totem#2580 slice-2).
 *
 * Git exits 0 on a removal that leaves the directory standing (the husk class
 * the estate sensor keeps finding), so the `wt remove` verb never trusts the
 * exit code: it deletes, then RE-VERIFIES, and this module is the deletion
 * half of that contract.
 *
 * Three passes, in order, and the order is load-bearing:
 *   1. **Strip** every reparse point / symlink / junction, WITHOUT following
 *      it. The link itself is unlinked; its target is not touched, not
 *      descended into, and not deleted. This is the same code on POSIX
 *      (symlinks) and win32 (symlinks + junctions) — `lstat` answers
 *      `isSymbolicLink()` for a directory junction, and libuv's `unlink`
 *      removes a directory reparse point by dropping the link. A worktree
 *      commonly carries a `node_modules` full of pnpm links, and one followed
 *      junction would delete a store OUTSIDE the tree.
 *   2. **Delete** recursively with retries — Windows hands back EBUSY/EPERM
 *      while an indexer or a just-exited git still holds a handle, and a
 *      single attempt reads that as a permanent failure.
 *   3. **Re-verify** with a no-follow existence probe. The result is reported,
 *      never asserted: the caller decides, and `wt remove` only exits 0 when
 *      this says the directory is gone.
 *
 * Nothing here throws for an ordinary filesystem outcome. A failed strip, a
 * failed delete, and a surviving directory are all RETURNED, so the caller can
 * name the survivors in its error rather than surfacing a raw ENOTEMPTY.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Delete attempts (each = strip pass + recursive rm) before giving up. */
const RESIDUE_ATTEMPTS = 3;
/** Pause between whole attempts — long enough for a handle to be released. */
const RESIDUE_RETRY_DELAY_MS = 150;
/** `fs.rmSync`'s own inner retry budget for EBUSY/EPERM/ENOTEMPTY. */
const RM_MAX_RETRIES = 3;
const RM_RETRY_DELAY_MS = 100;
/** Cap on survivor paths collected for the failure message. */
const SURVIVOR_SAMPLE_LIMIT = 10;

export interface ResidueRemovalResult {
  /** True only when a no-follow probe confirms the directory is gone. */
  removed: boolean;
  /** Links unlinked by the strip pass — reported so the finish is not silent. */
  strippedLinks: string[];
  /** Up to {@link SURVIVOR_SAMPLE_LIMIT} paths still present, for the error. */
  survivors: string[];
  /** The last delete failure, when one happened. */
  lastError?: string;
  /** How many strip+delete attempts ran. */
  attempts: number;
}

export interface ResidueRemovalOptions {
  dir: string;
  /** Test seam — production callers take the default. */
  attempts?: number;
  /** Test seam — production callers take the default. */
  retryDelayMs?: number;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** No-follow existence probe: a dangling link still counts as PRESENT. */
export function residuePathExists(p: string): boolean {
  // totem-context: intentional cleanup — an ENOENT/EACCES lstat is exactly the "absent" answer this probe reports; the caller re-verifies and fails loud on a survivor rather than acting on a throw.
  try {
    fs.lstatSync(p);
    return true;
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    return false;
  }
}

/**
 * Unlink one link WITHOUT following it. `unlink` covers file symlinks on every
 * platform and directory reparse points on win32 (libuv drops the link rather
 * than the target); `rmdir` is the fallback for the directory-symlink shape
 * POSIX reports as EPERM/EISDIR on unlink. Neither call descends, so the
 * target is untouched by construction.
 */
function unlinkNoFollow(target: string): boolean {
  // totem-context: intentional cleanup — a failed `unlink` falls through to the `rmdir` shape below; the strip pass reports what it could not remove instead of aborting the whole finish on one stubborn link.
  try {
    fs.unlinkSync(target);
    return true;
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    // totem-context: intentional cleanup — a link that resists BOTH removal shapes is left for the recursive delete to hit; the caller learns about it from the survivor list, never from a swallowed throw.
    try {
      fs.rmdirSync(target);
      return true;
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      return false;
    }
  }
}

/**
 * Depth-first strip of every reparse point under `dir`. Recursion enters REAL
 * directories only — a junction answers `isSymbolicLink()` first and is
 * unlinked, so the walk can never leave the tree (and cannot cycle).
 */
export function stripReparsePoints(dir: string): string[] {
  const stripped: string[] = [];

  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    // totem-context: intentional cleanup — an unreadable or already-deleted directory contributes no links to strip; the recursive delete below still runs over it and the final verify is what decides success.
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      let stat: fs.Stats;
      // totem-context: intentional cleanup — an entry that vanished between readdir and lstat needs no strip; skipping it is the correct outcome and the verify pass still catches anything left behind.
      try {
        stat = fs.lstatSync(child);
        // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
      } catch {
        continue;
      }
      // Checked BEFORE `isDirectory()`: a junction reports both on win32, and
      // descending into one is precisely the out-of-tree deletion this pass
      // exists to prevent.
      if (stat.isSymbolicLink()) {
        if (unlinkNoFollow(child)) stripped.push(child);
        continue;
      }
      if (stat.isDirectory()) walk(child);
    }
  };

  if (!residuePathExists(dir)) return stripped;
  // A worktree path that is ITSELF a link is unlinked whole — never walked.
  // totem-context: intentional cleanup — an unreadable top-level lstat leaves the walk to the recursive delete; the finish's verify pass is the authority on whether anything survived.
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) {
      if (unlinkNoFollow(dir)) stripped.push(dir);
      return stripped;
    }
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    return stripped;
  }
  walk(dir);
  return stripped;
}

/** Up to `SURVIVOR_SAMPLE_LIMIT` paths still present under (and including) `dir`. */
function collectSurvivors(dir: string): string[] {
  if (!residuePathExists(dir)) return [];
  const survivors: string[] = [dir];
  const walk = (current: string): void => {
    if (survivors.length >= SURVIVOR_SAMPLE_LIMIT) return;
    let entries: fs.Dirent[];
    // totem-context: intentional cleanup — an unreadable survivor still counts (its parent is already listed); this walk only enriches a failure message and must never throw over one.
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      return;
    }
    for (const entry of entries) {
      if (survivors.length >= SURVIVOR_SAMPLE_LIMIT) return;
      const child = path.join(current, entry.name);
      survivors.push(child);
      if (entry.isDirectory()) walk(child);
    }
  };
  walk(dir);
  return survivors;
}

/**
 * Strip links, delete recursively with retries, then verify absence. Never
 * throws on a filesystem outcome — `removed: false` plus `survivors` is the
 * failure report, and the caller turns that into its own loud error.
 */
export async function removeWorktreeResidue(
  options: ResidueRemovalOptions,
): Promise<ResidueRemovalResult> {
  const dir = path.resolve(options.dir);
  const maxAttempts = options.attempts ?? RESIDUE_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? RESIDUE_RETRY_DELAY_MS;

  const strippedLinks: string[] = [];
  let lastError: string | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    attempts = attempt + 1;
    if (!residuePathExists(dir)) break;
    strippedLinks.push(...stripReparsePoints(dir));
    // totem-context: intentional cleanup — a failed delete is RETRIED and then REPORTED (`removed: false` + survivors), because a Windows EBUSY from a lingering handle is an ordinary transient here; the verify pass below, not this catch, decides the outcome.
    try {
      // totem-ignore-next-line mmnto-ai/totem#2580 — false positive: the line-anchored rmSync rules cannot see the multi-line options object; maxRetries/retryDelay ARE set below, and this call is the removal verb's own retry-hardened deletion routine, not test-teardown temp cleanup.
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: RM_MAX_RETRIES,
        retryDelay: RM_RETRY_DELAY_MS,
      });
      lastError = undefined;
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch (err) {
      lastError = describe(err);
    }
    if (!residuePathExists(dir)) break;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  const removed = !residuePathExists(dir);
  return {
    removed,
    strippedLinks,
    survivors: removed ? [] : collectSurvivors(dir),
    ...(lastError === undefined ? {} : { lastError }),
    attempts,
  };
}
