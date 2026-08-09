import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

/** Options for {@link writeFileAtomicSync}. */
export interface AtomicWriteOptions {
  /**
   * Explicit permission bits for the written file. When provided, wins over
   * an existing target's preserved mode (the caller is stating intent — e.g.
   * a recovery artifact carrying its SOURCE file's mode). When omitted, an
   * existing target keeps its own bits and a new target gets the process
   * umask default. POSIX-only; ignored on win32 (the install-hooks chmod
   * convention).
   */
  mode?: number;
}

/**
 * Atomic user-file write — the shared helper the Tenet 4 User-File Mutation
 * Contract corollary mandates (mmnto-ai/totem#2620; canonical text:
 * `mmnto-ai/totem-strategy:design-tenets.md`). Observable state after any
 * outcome is the old bytes or the new bytes — never torn, metadata included.
 *
 * Ordering is contract, not implementation detail (author intent-read on the
 * #2620 Q2 consult): metadata lands on the TEMP file and the rename comes
 * last. Rename-then-repair would ship new-bytes-with-wrong-metadata on a
 * chmod/chown failure — a torn state in metadata clothing.
 *
 *   1. Resolve an existing symlink target to its real path — link identity
 *      survives (a bare rename would replace the link with a regular file).
 *      A dangling or cyclic link throws with the target untouched.
 *   2. Write to a unique same-volume temp (`<target>.<pid>-<uuid8>.tmp`):
 *      same-volume keeps the rename atomic (no EXDEV copy window); PID/time
 *      entropy alone collides under concurrency (lesson-bc2194f8), so the
 *      name carries UUID entropy and opens `wx` — a collision fails loud
 *      instead of two writers interleaving one temp path.
 *   3. fsync the temp fd. Declared boundary: no directory fsync (not
 *      portable on Windows), so crash durability of the rename itself is
 *      best-effort.
 *   4. Apply mode — and ownership, when the existing target's uid/gid differ
 *      from the process (POSIX) — to the temp. A chown failure throws: a
 *      silent ownership flip is metadata drift, never an "expected" condition
 *      under Tenet 4's boundary carve-out.
 *   5. Rename over the target.
 *
 * Throws on any failure with the temp cleaned up and the target's old bytes
 * intact. Callers running per-item best-effort loops catch per item and
 * account the failure (Tenet 4's licensed shape: failure accounting + a loud
 * backstop).
 *
 * Declared boundaries (falsification round, 2026-08-09):
 * - Windows: a rename over a target held open by another process fails
 *   EPERM/EACCES (old bytes remain); mode/ownership application is skipped;
 *   the temp suffix adds ~20 chars (`.<pid>-<uuid8>.tmp`), which can cross
 *   MAX_PATH on already-long target paths.
 * - HARD-link identity is NOT preserved: rename-over replaces the directory
 *   entry, so a target with nlink > 1 silently decouples from its other
 *   names (rule 1 names symlink identity only).
 * - Two behavior deltas vs the in-place writeFileSync this replaces: a
 *   cross-uid/gid target the process cannot chown now throws (previously an
 *   in-place write succeeded), and the parent DIRECTORY must be writable
 *   (in-place writes needed only the file writable).
 * - On a failure already in flight, temp cleanup is best-effort: if the
 *   cleanup itself fails — or the process is hard-killed mid-write — a
 *   `<target>.<pid>-<uuid8>.tmp` file can remain beside the target.
 */
export function writeFileAtomicSync(
  targetPath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): void {
  let writePath = targetPath;
  let existing: fs.Stats | undefined;
  const linkStat = fs.lstatSync(targetPath, { throwIfNoEntry: false });
  if (linkStat?.isSymbolicLink()) {
    writePath = fs.realpathSync(targetPath);
    existing = fs.statSync(writePath);
  } else if (linkStat !== undefined) {
    existing = linkStat;
  }

  const tmpPath = `${writePath}.${process.pid}-${crypto.randomUUID().slice(0, 8)}.tmp`;
  let fd: number | undefined;
  try {
    // POSIX: create the temp AT the final permission bits (still umask-masked;
    // the explicit chmod below sets them exactly) — creating at the 0666
    // default and chmodding later would give a 0600 target's new bytes a brief
    // world-readable window (2026-08-09 falsification round 1, finding 12).
    // win32 passes NO create-mode: libuv maps a missing write bit to
    // FILE_ATTRIBUTE_READONLY at create, which would mint read-only temps and
    // EPERM re-writes — the "mode ignored on win32" boundary stays true
    // (round 2, F4).
    const createMode =
      process.platform === 'win32'
        ? undefined
        : (options.mode ?? (existing === undefined ? undefined : existing.mode & 0o7777));
    fd = fs.openSync(tmpPath, 'wx', createMode);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (process.platform !== 'win32') {
      const mode = options.mode ?? (existing === undefined ? undefined : existing.mode & 0o7777);
      if (mode !== undefined) {
        fs.chmodSync(tmpPath, mode);
      }
      if (
        existing !== undefined &&
        typeof process.getuid === 'function' &&
        typeof process.getgid === 'function' &&
        (existing.uid !== process.getuid() || existing.gid !== process.getgid())
      ) {
        fs.chownSync(tmpPath, existing.uid, existing.gid);
      }
    }

    fs.renameSync(tmpPath, writePath);
  } finally {
    try {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
      if (fs.existsSync(tmpPath)) {
        // No maxRetries/retryDelay: Node documents them as ignored when
        // `recursive` is not true, and this target is always a plain file —
        // the advisory suggesting them is a false fit on this path.
        fs.rmSync(tmpPath, { force: true });
      }
      // totem-context: intentional cleanup — a secondary close/rm failure on the temp must not mask the in-flight write error
    } catch {
      /* temp cleanup is best-effort; the throw in flight carries the cause */
    }
  }
}
