/**
 * Lightweight filesystem lock for preventing concurrent mutations
 * to .totem/lessons/ and .lancedb/ directories.
 *
 * Uses a lockfile with PID + timestamp. Stale locks (>30s) are
 * automatically cleaned up to handle crashed processes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { TotemError } from './errors.js';

const LOCK_FILE = 'sync.lock';
const STALE_THRESHOLD_MS = 120_000; // 2 minutes — sync can take 30-60s on large repos
const MAX_RETRIES = 20;
const BASE_DELAY_MS = 500;

interface LockData {
  pid: number;
  timestamp: number;
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
      if (isStale(existing)) {
        // Stale timestamp is the final authority — delete regardless of PID liveness.
        // Per lesson-5b1929d1: PID checks fail across container namespaces.
        onWarn?.(
          `Removing stale lock from PID ${existing.pid} (${Math.round((Date.now() - existing.timestamp) / 1000)}s old)`,
        );
        try {
          fs.unlinkSync(file);
        } catch {
          // Another process may have cleaned it up
        }
      } else if (!isProcessAlive(existing.pid)) {
        // Lock is fresh but owning process is dead (e.g., Ctrl+C during sync)
        onWarn?.(
          `Removing orphaned lock from dead PID ${existing.pid} (${Math.round((Date.now() - existing.timestamp) / 1000)}s old)`,
        );
        try {
          fs.unlinkSync(file);
        } catch {
          // Another process may have cleaned it up
        }
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
      // EEXIST = another process grabbed it between our read and write
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        const delay = backoffDelay(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw new TotemError(
    'SYNC_FAILED',
    `Could not acquire sync lock after ${MAX_RETRIES} attempts.`,
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
    return await fn();
  } finally {
    removeHandlers();
    release();
  }
}
