import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireLock, withLock } from './lock.js';
import { cleanTmpDir } from './test-utils.js';

describe('acquireLock', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lock-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
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

  it('cleans up stale locks from dead processes', async () => {
    // Write a stale lock with a PID guaranteed not to exist (PID 1 is init/system, use a very high PID)
    const lockPath = path.join(tmpDir, 'sync.lock');
    const deadPid = 2_147_483_647; // max 32-bit PID — virtually guaranteed to be unused
    fs.writeFileSync(lockPath, JSON.stringify({ pid: deadPid, timestamp: Date.now() - 130_000 }));

    const warnings: string[] = [];
    const release = await acquireLock(tmpDir, (msg) => warnings.push(msg));

    expect(warnings.some((w) => w.includes('stale') || w.includes('dead'))).toBe(true);
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

  it('withLock serializes concurrent operations', async () => {
    const order: number[] = [];
    const op = (id: number, ms: number) =>
      withLock(tmpDir, async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, ms));
        order.push(id * 10);
      });

    // Launch two operations concurrently — second must wait for first
    await Promise.all([op(1, 100), op(2, 50)]);

    // First operation should fully complete before second starts
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(10);
    expect(order[2]).toBe(2);
    expect(order[3]).toBe(20);
  });

  it('recovers from corrupted lockfile', async () => {
    const lockFile = path.join(tmpDir, 'sync.lock');
    fs.writeFileSync(lockFile, 'not valid json');

    const release = await acquireLock(tmpDir);
    expect(fs.existsSync(lockFile)).toBe(true);
    release();
  });

  it('recovers from empty lockfile', async () => {
    const lockFile = path.join(tmpDir, 'sync.lock');
    fs.writeFileSync(lockFile, '');

    const release = await acquireLock(tmpDir);
    expect(fs.existsSync(lockFile)).toBe(true);
    release();
  });

  it('creates totemDir if it does not exist', async () => {
    const nested = path.join(tmpDir, 'deep', 'nested', '.totem');
    const release = await acquireLock(nested);
    expect(fs.existsSync(path.join(nested, 'sync.lock'))).toBe(true);
    release();
  });
});
