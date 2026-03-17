/**
 * Lightweight filesystem lock for preventing concurrent mutations
 * to .totem/lessons/ and .lancedb/ directories.
 *
 * Uses a lockfile with PID + timestamp. Stale locks (>30s) are
 * automatically cleaned up to handle crashed processes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const LOCK_FILE = 'sync.lock';
const STALE_THRESHOLD_MS = 30_000;
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 100;

interface LockData {
  pid: number;
  timestamp: number;
}

function lockPath(totemDir: string): string {
  return path.join(totemDir, LOCK_FILE);
}

function isStale(data: LockData): boolean {
  return Date.now() - data.timestamp > STALE_THRESHOLD_MS;
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
      typeof (data as LockData).timestamp === 'number'
    ) {
      return data as LockData;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Attempt to acquire the sync lock.
 * Returns a release function on success, or throws after retries are exhausted.
 */
export async function acquireLock(
  totemDir: string,
  onWarn?: (msg: string) => void,
): Promise<() => void> {
  const file = lockPath(totemDir);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const existing = readLock(file);

    if (existing) {
      if (isStale(existing)) {
        // Verify the owning process is actually dead before removing (prevents TOCTOU race)
        let isOwnerAlive = false;
        try {
          process.kill(existing.pid, 0);
          isOwnerAlive = true;
        } catch (err) {
          // ESRCH = process gone (safe to remove). Other errors = assume alive.
          if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
            isOwnerAlive = true;
          }
        }

        if (isOwnerAlive) {
          if (attempt === 0) {
            onWarn?.(`Waiting for sync lock (held by PID ${existing.pid}, stale but process alive)...`);
          }
          const delay = backoffDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        onWarn?.(
          `Removing stale lock from dead PID ${existing.pid} (${Math.round((Date.now() - existing.timestamp) / 1000)}s old)`,
        );
        try {
          fs.unlinkSync(file);
        } catch {
          // Another process may have cleaned it up
        }
      } else {
        // Lock is held and not stale — wait and retry
        if (attempt === 0) {
          onWarn?.(`Waiting for sync lock (held by PID ${existing.pid})...`);
        }
        const delay = backoffDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }

    // Try to acquire (ensure directory exists)
    const lockData: LockData = { pid: process.pid, timestamp: Date.now() };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(lockData), { flag: 'wx' });
      // Acquired — return release function
      return () => {
        try {
          fs.unlinkSync(file);
        } catch {
          // Already cleaned up
        }
      };
    } catch (err) {
      // EEXIST means another process grabbed it between our read and write
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        const delay = backoffDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `[Totem Error] Could not acquire sync lock after ${MAX_RETRIES} attempts. ` +
      `Another totem process may be running. Check ${file} or delete it manually.`,
  );
}

/**
 * Execute a function while holding the sync lock.
 * Automatically releases the lock when done (even on error).
 */
export async function withLock<T>(
  totemDir: string,
  fn: () => Promise<T>,
  onWarn?: (msg: string) => void,
): Promise<T> {
  const release = await acquireLock(totemDir, onWarn);
  try {
    return await fn();
  } finally {
    release();
  }
}
