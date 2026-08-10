/**
 * The user-level worktree registry (`~/.totem/worktrees.json`) behind
 * `totem wt create|remove|list` (mmnto-ai/totem#2580 slice-2).
 *
 * A SIBLING file to `registry.json`, never a key inside it: `RegistrySchema` is
 * `z.record(repoPath, RegistryEntrySchema)`, so any non-repo-entry key would
 * fail schema validation and flip the WHOLE sync registry to "unreadable". The
 * two files share one lock directory (`~/.totem`) and nothing else — the read
 * path of `registry.json` is untouched by every verb here.
 *
 * Two independent lifecycles live in this file, and the independence is the
 * point:
 *   - `roots[]` accretes every container root a worktree was ever created
 *     under and is NEVER pruned by removal. It is what keeps a recorded
 *     location reachable for `doctor --estate` after the last live entry under
 *     it is gone (PR #2586 round-3 MINOR-3).
 *   - `worktrees{}` is entry accounting: written BEFORE `git worktree add`
 *     (an intent record — a phantom entry fails VISIBLY in `wt list`, an
 *     unrecorded worktree fails invisibly), deleted ONLY after a removal has
 *     verified the directory is actually gone.
 *
 * Concurrency and durability copy `updateRegistryEntry` exactly: `acquireLock`
 * on `~/.totem` serializes mutations, and every write is a PID-suffixed temp
 * file renamed into place. Reads warn-and-degrade (`readRegistry`'s posture);
 * mutations REFUSE to overwrite a file whose schema does not parse.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { TotemParseError } from './errors.js';
import { writeFileAtomicSync } from './fs-atomic.js';
import { acquireLock } from './lock.js';
import { readJsonSafe } from './sys/fs.js';

/** The on-disk compatibility contract for `~/.totem/worktrees.json`. */
export const WORKTREE_REGISTRY_SCHEMA_VERSION = 1;

export const WorktreeEntrySchema = z
  .object({
    /** Home repo root (absolute) the worktree was created from. */
    repo: z.string(),
    /** Creating seat id (`resolveSelfSender`, or an explicit `--seat`). */
    seat: z.string(),
    branch: z.string(),
    /** Issue number the worktree was cut for, when one was named. */
    ticket: z.string().optional(),
    /** ISO instant, stamped at the write site. */
    createdAt: z.string(),
  })
  .passthrough(); // Preserve unknown fields from newer CLI versions

export const WorktreeFileSchema = z.object({
  schemaVersion: z.literal(WORKTREE_REGISTRY_SCHEMA_VERSION),
  /** Every container root ever created under — accretes, never auto-pruned. */
  roots: z.array(z.string()),
  /** Absolute worktree path → entry. */
  worktrees: z.record(z.string(), WorktreeEntrySchema),
});

export type WorktreeEntry = z.infer<typeof WorktreeEntrySchema>;
export type WorktreeFile = z.infer<typeof WorktreeFileSchema>;

/** Resolve the registry directory lazily so tests can mock os.homedir(). */
function worktreeRegistryDir(): string {
  return path.join(os.homedir(), '.totem');
}

/** Resolve the registry file path lazily so tests can mock os.homedir(). */
export function worktreeRegistryPath(): string {
  return path.join(worktreeRegistryDir(), 'worktrees.json');
}

/** The zero-config container root (`~/.totem/worktrees`) — the ruling's Q1 default. */
export function defaultWorktreeRoot(): string {
  return path.join(worktreeRegistryDir(), 'worktrees');
}

/** A fresh, valid, empty registry — the first-run and degraded-read value. */
export function emptyWorktreeFile(): WorktreeFile {
  return { schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION, roots: [], worktrees: {} };
}

/**
 * Windows git and Node can disagree on drive-letter case (GCA #2293), so path
 * identity folds on win32 ONLY — POSIX filesystems are case-sensitive and
 * folding there conflates real paths (the author-sandbox.ts:121 precedent).
 */
function foldCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** Case-folded (win32 only), resolved key for comparing two worktree paths. */
export function worktreePathKey(p: string): string {
  return foldCase(path.resolve(p));
}

/**
 * No-follow existence probe: a dangling symlink/junction still EXISTS here,
 * and the probe FAILS CLOSED — only ENOENT/ENOTDIR mean "absent". Any other
 * errno (EACCES on a denied parent, EIO, an offline share) reports the path as
 * PRESENT: a caller that cannot KNOW must fail loud, never delete a registry
 * entry for a directory that may still stand (#2580 bot round, CR findings
 * 8 + 9 — this retires the errno-tri-state deferral).
 */
export function worktreePathExists(p: string): boolean {
  // totem-context: intentional cleanup — the catch IS the answer, not a swallow: ENOENT/ENOTDIR are the two errnos that PROVE absence, and every other lstat failure deliberately reports "present" so removal fails closed instead of reading an unknowable path as gone.
  try {
    fs.lstatSync(p);
    return true;
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    // A non-object throw carries no errno and cannot PROVE absence — it reads
    // as present, the same fail-closed answer as any unrecognized failure
    // (round 2, GCA null-safety finding).
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

/** No-follow directory probe — a symlinked/junctioned path is not a directory. */
function isRealDirectory(p: string): boolean {
  // totem-context: intentional cleanup — an unreadable or missing recorded root degrades to "not a directory", which the doctor coupling reads as an empty sweep rather than a scan hole (the ruling's Q3 filter).
  try {
    return fs.lstatSync(p).isDirectory();
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch {
    return false;
  }
}

/**
 * Read the worktree registry. Missing file → empty (expected on first run);
 * any other failure warns and degrades to empty, mirroring `readRegistry` so a
 * corrupt file can never take a read-only verb down with it.
 */
export function readWorktreeRegistry(onWarn?: (msg: string) => void): WorktreeFile {
  // totem-context: intentional cleanup — warn-not-throw is the ruled read contract (mirrors readRegistry): a corrupt registry file must never take a read-only verb down with it; the onWarn callback is the loud path, and a missing file is the expected first-run case.
  try {
    return readJsonSafe(worktreeRegistryPath(), WorktreeFileSchema);
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    if (err instanceof TotemParseError && err.message.includes('File not found')) {
      // Expected until the first `wt create` — silently return empty
      return emptyWorktreeFile();
    }
    onWarn?.(
      `Cannot read worktree registry: ${err instanceof Error ? err.message : String(err)} — using empty registry`,
    );
    return emptyWorktreeFile();
  }
}

/**
 * Find a recorded entry by path, folding case on win32 only. Returns the
 * STORED key alongside the entry so a caller can delete exactly what it found.
 */
export function findWorktreeEntry(
  file: WorktreeFile,
  worktreePath: string,
): { key: string; entry: WorktreeEntry } | undefined {
  const wanted = worktreePathKey(worktreePath);
  for (const [key, entry] of Object.entries(file.worktrees)) {
    if (worktreePathKey(key) === wanted) return { key, entry };
  }
  return undefined;
}

/**
 * The recorded roots that still EXIST on disk — the projection both doctor
 * consumers sweep. A recorded root that is gone is an empty sweep, not a scan
 * hole (the ruling's Q3), so it is filtered here rather than handed to
 * `scanEstate` as an unscannable row.
 */
export function existingWorktreeRoots(file: WorktreeFile): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const root of file.roots) {
    const resolved = path.resolve(root);
    const key = foldCase(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    if (isRealDirectory(resolved)) roots.push(resolved);
  }
  return roots;
}

/**
 * Partition recorded roots into the sweep classes the estate consumers hand to
 * `scanEstate`. Only the DEFAULT root (`~/.totem/worktrees`) carries container
 * semantics — it exists solely to hold worktrees, so location alone is husk
 * evidence there. Every other recorded root is a location the operator also
 * uses for other things (a shared tmp, a scratch dir); those sweep as STANDARD
 * roots, where husk-ness needs shape evidence — so one `wt create --root`
 * against a scratch dir can never permanently arm by-location residue rows for
 * every unrelated directory in it (#2580 slice-2 falsification, finding 11).
 */
export function partitionWorktreeRoots(roots: string[]): {
  container: string[];
  standard: string[];
} {
  const defaultKey = foldCase(path.resolve(defaultWorktreeRoot()));
  const container: string[] = [];
  const standard: string[] = [];
  for (const root of roots) {
    (foldCase(path.resolve(root)) === defaultKey ? container : standard).push(root);
  }
  return { container, standard };
}

/**
 * Load the file for MUTATION. Unlike the read path this REFUSES to proceed on
 * a schema failure: silently replacing an unparseable registry would delete
 * every recorded root and entry it holds (`updateRegistryEntry`'s posture).
 */
function loadForMutation(filePath: string): WorktreeFile {
  if (!fs.existsSync(filePath)) return emptyWorktreeFile();
  try {
    return readJsonSafe(filePath, WorktreeFileSchema);
  } catch (err) {
    if (err instanceof TotemParseError && err.message.includes('Schema validation failed')) {
      throw new TotemParseError(
        'Worktree registry file has invalid schema — refusing to overwrite.',
        `Delete ${filePath} to reset (recorded roots and entries are lost).`,
        err.cause,
      );
    }
    throw err;
  }
}

/** Unique temp + rename via the shared corollary helper (mmnto-ai/totem#2620):
 *  a concurrent reader never sees partial JSON. */
function writeAtomic(filePath: string, file: WorktreeFile): void {
  writeFileAtomicSync(filePath, JSON.stringify(file, null, 2) + '\n');
}

/**
 * Record a worktree and the root it lives under, under the `~/.totem` lock.
 * Called BEFORE `git worktree add` — the intent record is what makes a failed
 * creation visible instead of invisible.
 */
export async function addWorktreeEntry(args: {
  worktreePath: string;
  entry: WorktreeEntry;
  root: string;
}): Promise<void> {
  const dir = worktreeRegistryDir();
  const filePath = worktreeRegistryPath();
  fs.mkdirSync(dir, { recursive: true });

  const release = await acquireLock(dir);
  try {
    const file = loadForMutation(filePath);
    const root = path.resolve(args.root);
    // Roots accrete and are deduped case-folded on win32 only; the recorded
    // spelling of the FIRST writer wins so the disclosure stays stable.
    if (!file.roots.some((existing) => foldCase(path.resolve(existing)) === foldCase(root))) {
      file.roots.push(root);
    }
    // Overwrite of an occupied key is BY DESIGN, not an oversight: the only
    // path that reaches here with an existing entry is a re-create over a
    // STALE record (create refuses when the target directory exists, so the
    // dir is gone and the old entry describes nothing). Replacing it is the
    // recovery; callers must not assume exclusive-write semantics. The
    // delete side is what carries identity (expectCreatedAt guard below).
    file.worktrees[path.resolve(args.worktreePath)] = args.entry;
    writeAtomic(filePath, file);
  } finally {
    release();
  }
}

/**
 * Delete a recorded entry under the `~/.totem` lock. Roots are deliberately
 * untouched: their durability is independent of entry lifecycle, which is what
 * keeps an emptied container root reachable for the estate sweep.
 *
 * Callers must only reach this AFTER verifying the directory is absent.
 * Returns whether an entry was actually deleted (a git-listed worktree with no
 * registry entry — the legacy estate — is a no-op, not an error).
 *
 * `expectCreatedAt` is an identity guard for the verify→delete window: a
 * concurrent `wt create` can re-record the SAME path between a removal's
 * absence check and this lock acquisition, and an unguarded delete-by-path
 * would erase the replacement's durable record — the invisible-unrecorded
 * class this registry exists to prevent (#2580 bot round, Greptile P1). When
 * the stored entry's `createdAt` differs from the expected one, the entry is
 * left in place and `false` is returned.
 */
export async function deleteWorktreeEntry(
  worktreePath: string,
  opts?: { expectCreatedAt?: string },
): Promise<boolean> {
  const dir = worktreeRegistryDir();
  const filePath = worktreeRegistryPath();
  if (!fs.existsSync(filePath)) return false;
  fs.mkdirSync(dir, { recursive: true });

  const release = await acquireLock(dir);
  try {
    const file = loadForMutation(filePath);
    const found = findWorktreeEntry(file, worktreePath);
    if (found === undefined) return false;
    if (opts?.expectCreatedAt !== undefined && found.entry.createdAt !== opts.expectCreatedAt) {
      return false;
    }
    delete file.worktrees[found.key];
    writeAtomic(filePath, file);
    return true;
  } finally {
    release();
  }
}
