/**
 * Lightweight filesystem lock for preventing concurrent mutations
 * to .totem/lessons/ and .lancedb/ directories.
 *
 * Uses a lockfile with PID + heartbeat timestamp + per-acquisition holder id.
 * The holder refreshes the timestamp every HEARTBEAT_INTERVAL_MS, so a stale
 * timestamp means many consecutive missed beats — a dead or wedged holder —
 * and the lock is reclaimed (#2564). Every deletion re-reads the file first
 * and removes only the exact lock it judged dead (TOCTOU narrowing,
 * lesson-b813e60b).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { TotemError } from './errors.js';

const LOCK_FILE = 'sync.lock';
// 8 missed heartbeats. The long in-lock waits that motivated #2564 (gemini
// ingest pacing, 429 window backoff — #2562) are awaits, so the event loop is
// idle and beats keep firing through them; only a dead process or a >2min
// synchronous stall goes stale.
const STALE_THRESHOLD_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_RETRIES = 20;
const BASE_DELAY_MS = 500;

interface LockData {
  pid: number;
  /** Last heartbeat (the acquisition instant until the first beat). */
  timestamp: number;
  /** Acquisition instant — provenance only. Absent on pre-#2564 locks. */
  createdAt?: number;
  /**
   * Opaque per-acquisition token; heartbeats and every deletion verify
   * against it. Absent on pre-#2564 locks.
   */
  holderId?: string;
}

/**
 * Release handle returned by acquireLock: callable to release, plus a probe
 * for lost mutual exclusion. Callable-with-property keeps the shape
 * assignable to the pre-#2564 `() => void` return type.
 */
export interface LockRelease {
  (): void;
  /** True once this hold observably lost the lock to another process. One-way latch. */
  isLost(): boolean;
}

/** Timing seams for tests — production callers omit and get the defaults above. */
export interface AcquireLockOptions {
  staleThresholdMs?: number;
  heartbeatIntervalMs?: number;
}

/**
 * Check if a process is still running via signal 0 (no-op probe).
 * Returns true if alive, false if dead (ESRCH), true on permission errors (assume alive).
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 does not terminate — it only checks if the process exists
    process.kill(pid, 0); // totem-ignore: signal-0 probe, not a kill
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function lockPath(totemDir: string): string {
  return path.join(totemDir, LOCK_FILE);
}

function isStale(data: LockData, staleThresholdMs: number): boolean {
  return Date.now() - data.timestamp > staleThresholdMs;
}

const MAX_BACKOFF_EXPONENT = 5;

function backoffDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, Math.min(attempt, MAX_BACKOFF_EXPONENT));
}

function readLock(filePath: string): LockData | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (
      data !== null &&
      typeof data === 'object' &&
      typeof (data as LockData).pid === 'number' &&
      Number.isInteger((data as LockData).pid) &&
      typeof (data as LockData).timestamp === 'number' &&
      (data as LockData).timestamp > 0 &&
      // Optional #2564 fields: a legacy {pid, timestamp} lock parses and ages
      // into staleness exactly as before — no special-casing.
      ((data as LockData).createdAt === undefined ||
        typeof (data as LockData).createdAt === 'number') &&
      ((data as LockData).holderId === undefined || typeof (data as LockData).holderId === 'string')
    ) {
      return data as LockData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete the lock only if its content still matches the snapshot we judged
 * dead — a peer that already stole and rewrote the lock must not lose its
 * fresh lock to our stale judgment (lesson-b813e60b). A window between the
 * re-read and the unlink remains; this narrows it from the whole judgment
 * gap to a few instructions. Exported for direct contract tests — same-process
 * tests cannot interleave the synchronous judge→delete sequence.
 */
export function deleteLockIfUnchanged(filePath: string, snapshot: LockData): void {
  const current = readLock(filePath);
  if (
    current === null ||
    current.pid !== snapshot.pid ||
    current.timestamp !== snapshot.timestamp ||
    current.holderId !== snapshot.holderId
  ) {
    return;
  }
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Another process may have cleaned it up
  }
}

/**
 * Attempt to acquire the sync lock.
 * Returns a release handle on success, or throws after retries are exhausted.
 */
export async function acquireLock(
  totemDir: string,
  onWarn?: (msg: string) => void,
  opts?: AcquireLockOptions,
): Promise<LockRelease> {
  const file = lockPath(totemDir);
  const staleThresholdMs = opts?.staleThresholdMs ?? STALE_THRESHOLD_MS;
  const heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = readLock(file);

    // Corrupted lockfile (empty, bad JSON) — remove if not mid-write
    if (!existing && fs.existsSync(file)) {
      try {
        const stat = fs.statSync(file);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > 1000) {
          // File is old enough to be genuinely corrupted, not mid-write
          fs.unlinkSync(file);
        } else {
          // File may be mid-write by another process — wait and retry
          const delay = backoffDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      } catch {
        // Another process may have cleaned it up
      }
      continue;
    }

    if (existing) {
      if (isStale(existing, staleThresholdMs)) {
        // Stale timestamp is the final authority — delete regardless of PID
        // liveness. Per lesson-5b1929d1: PID checks fail across container
        // namespaces. A live holder heartbeats, so stale means many
        // consecutive missed beats — dead or wedged either way (#2564).
        onWarn?.(
          `Removing stale lock from PID ${existing.pid} (${Math.round((Date.now() - existing.timestamp) / 1000)}s old)`,
        );
        deleteLockIfUnchanged(file, existing);
      } else if (!isProcessAlive(existing.pid)) {
        // Lock is fresh but owning process is dead (e.g., Ctrl+C during sync)
        onWarn?.(
          `Removing orphaned lock from dead PID ${existing.pid} (${Math.round((Date.now() - existing.timestamp) / 1000)}s old)`,
        );
        deleteLockIfUnchanged(file, existing);
      } else {
        // Lock is held by a live process — wait and retry
        if (attempt === 0) {
          onWarn?.(`Waiting for sync lock (held by PID ${existing.pid})...`);
        }
        const delay = backoffDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }

    // Try to acquire (ensure directory exists)
    const now = Date.now();
    const lockData: LockData = {
      pid: process.pid,
      timestamp: now,
      createdAt: now,
      holderId: crypto.randomUUID(),
    };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(lockData), { flag: 'wx' });
    } catch (err) {
      // EEXIST = another process grabbed it between our read and write
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        const delay = backoffDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
    return startHold(file, lockData, heartbeatIntervalMs, onWarn);
  }

  throw new TotemError(
    'SYNC_FAILED',
    `Could not acquire sync lock after ${MAX_RETRIES} attempts.`,
    `Another totem process may be running. Check ${file} or delete it manually.`,
  );
}

/**
 * Post-acquisition hold state (#2564). The heartbeat keeps the on-disk
 * timestamp fresh so staleness is a real death signal, self-verifies
 * ownership on every beat, and latches `lost` the moment the file carries
 * someone else's lock. Release is identity-verified for the same reason:
 * an unconditional unlink would delete a thief's valid lock on the way out.
 */
function startHold(
  file: string,
  lockData: LockData,
  heartbeatIntervalMs: number,
  onWarn?: (msg: string) => void,
): LockRelease {
  let lost = false;
  let warnedWriteFailure = false;
  // PID-unique temp + atomic rename: a competitor mid-read never sees partial JSON.
  const tmpFile = `${file}.${process.pid}.hb`;

  const markLost = () => {
    if (lost) return;
    lost = true;
    clearInterval(timer);
    onWarn?.(
      'sync.lock was taken over by another process — this hold no longer has mutual exclusion.',
    );
  };

  const beat = () => {
    if (lost) return;
    const current = readLock(file);
    if (current !== null && current.holderId !== lockData.holderId) {
      markLost();
      return;
    }
    if (current === null && fs.existsSync(file)) {
      // Unreadable content while we believe we hold the lock — never
      // overwrite unknown bytes. The next beat resolves it: a thief's
      // finished write reads as foreign (lost), transient weirdness reads
      // as ours again.
      return;
    }
    lockData.timestamp = Date.now();
    const payload = JSON.stringify(lockData);
    try {
      if (current === null) {
        // File vanished (manual cleanup). Reclaim atomically: wx loses to
        // any competitor that took the open window.
        fs.writeFileSync(file, payload, { flag: 'wx' });
      } else {
        fs.writeFileSync(tmpFile, payload);
        fs.renameSync(tmpFile, file);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        markLost();
        return;
      }
      // totem-context: intentional warn-once on a heartbeat write failure (mmnto-ai/totem#2564) — the lock ages toward stealable until a beat succeeds; theft, if it happens, is caught by the beat self-verify and surfaces as a loud abort at the pipeline flush boundary.
      if (!warnedWriteFailure) {
        warnedWriteFailure = true;
        onWarn?.(
          `sync.lock heartbeat write failed (${err instanceof Error ? err.message : String(err)}) — the lock ages toward stealable until a beat succeeds.`,
        );
      }
    }
  };

  const timer = setInterval(beat, heartbeatIntervalMs);
  timer.unref();

  const release = (() => {
    clearInterval(timer);
    try {
      fs.rmSync(tmpFile, { force: true });
    } catch {
      // Best-effort temp cleanup (e.g. a test replaced it with a directory)
    }
    const current = readLock(file);
    if (current !== null && current.holderId !== lockData.holderId) {
      // Stolen while we ran — the thief's lock is valid; leave it in place.
      markLost();
      return;
    }
    try {
      fs.unlinkSync(file);
    } catch {
      // Already cleaned up
    }
  }) as LockRelease;
  release.isLost = () => lost;
  return release;
}

/**
 * Execute a function while holding the sync lock.
 * Automatically releases the lock when done (even on error). The callback
 * receives the release handle so long-running work can probe `isLost()` at
 * its own mutation boundaries (#2564); zero-arg callbacks are unaffected.
 */
export async function withLock<T>(
  totemDir: string,
  fn: (lock: LockRelease) => Promise<T>,
  onWarn?: (msg: string) => void,
  opts?: AcquireLockOptions,
): Promise<T> {
  const release = await acquireLock(totemDir, onWarn, opts);

  // Best-effort cleanup on process termination (Ctrl+C, kill)
  const removeHandlers = () => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    if (process.platform !== 'win32') {
      process.removeListener('SIGHUP', onSighup);
      process.removeListener('SIGQUIT', onSigquit);
    }
  };
  const onSigint = () => {
    release();
    removeHandlers();
    process.kill(process.pid, 'SIGINT'); // totem-ignore: re-raising caught signal
  };
  const onSigterm = () => {
    release();
    removeHandlers();
    process.kill(process.pid, 'SIGTERM'); // totem-ignore: re-raising caught signal
  };
  const onSighup = () => {
    release();
    removeHandlers();
    process.kill(process.pid, 'SIGHUP'); // totem-ignore: re-raising caught signal
  };
  const onSigquit = () => {
    release();
    removeHandlers();
    process.kill(process.pid, 'SIGQUIT'); // totem-ignore: re-raising caught signal
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  if (process.platform !== 'win32') {
    process.on('SIGHUP', onSighup);
    process.on('SIGQUIT', onSigquit);
  }

  try {
    return await fn(release);
  } finally {
    removeHandlers();
    release();
  }
}
