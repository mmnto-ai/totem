import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireLock, withLock } from './lock.js';

describe('acquireLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lock-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('acquires and releases a lock', async () => {
    const release = await acquireLock(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'sync.lock'))).toBe(true);
    release();
    expect(fs.existsSync(path.join(tmpDir, 'sync.lock'))).toBe(false);
  });

  it('second caller waits and succeeds after first releases', async () => {
    const release1 = await acquireLock(tmpDir);

    // Start second acquisition (will wait)
    let acquired2 = false;
    const promise2 = acquireLock(tmpDir).then((release) => {
      acquired2 = true;
      return release;
    });

    // Second should still be waiting
    await new Promise((r) => setTimeout(r, 50));
    expect(acquired2).toBe(false);

    // Release first — second should acquire
    release1();
    const release2 = await promise2;
    expect(acquired2).toBe(true);
    release2();
  });

  it('cleans up stale locks', async () => {
    // Write a stale lock (timestamp 60s ago)
    const lockPath = path.join(tmpDir, 'sync.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999, timestamp: Date.now() - 60_000 }));

    const warnings: string[] = [];
    const release = await acquireLock(tmpDir, (msg) => warnings.push(msg));

    expect(warnings.some((w) => w.includes('stale'))).toBe(true);
    release();
  });

  it('withLock releases on success', async () => {
    const result = await withLock(tmpDir, async () => 42);
    expect(result).toBe(42);
    expect(fs.existsSync(path.join(tmpDir, 'sync.lock'))).toBe(false);
  });

  it('withLock releases on error', async () => {
    await expect(
      withLock(tmpDir, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(fs.existsSync(path.join(tmpDir, 'sync.lock'))).toBe(false);
  });
});
