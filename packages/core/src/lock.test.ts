import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireLock, deleteLockIfUnchanged, withLock } from './lock.js';
import { cleanTmpDir } from './test-utils.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

// ─── #2564: heartbeat + identity-verified deletion (ADR-115 induced cells) ───
//
// The defect: paced/throttled syncs (#2562 defaults) hold the lock for
// multi-minute wall-clock, the timestamp was written once at acquisition, and
// a >120s-stale timestamp was final authority — so a second sync stole the
// lock exactly when quota pressure was highest and ran concurrently under the
// checkpoint epoch. These cells lock in the heartbeat contract.

describe('lock heartbeat (#2564)', () => {
  let tmpDir: string;
  let lockFile: string;

  const readLockFile = () => JSON.parse(fs.readFileSync(lockFile, 'utf-8'));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lock-hb-'));
    lockFile = path.join(tmpDir, 'sync.lock');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('refreshes the timestamp while held and preserves acquisition identity', async () => {
    const release = await acquireLock(tmpDir, undefined, { heartbeatIntervalMs: 25 });
    const first = readLockFile();
    expect(typeof first.holderId).toBe('string');
    expect(first.createdAt).toBe(first.timestamp);

    await sleep(200);
    const second = readLockFile();
    expect(second.timestamp).toBeGreaterThan(first.timestamp);
    expect(second.holderId).toBe(first.holderId);
    expect(second.createdAt).toBe(first.createdAt);
    release();
  });

  it('a heartbeating hold is never judged stale by a competitor', async () => {
    // Beat (25ms) ≪ threshold (250ms): the on-disk timestamp can never age
    // past the threshold while the holder lives (10× margin absorbs CI stalls).
    const release = await acquireLock(tmpDir, undefined, {
      heartbeatIntervalMs: 25,
      staleThresholdMs: 250,
    });
    const holderId = readLockFile().holderId;

    const warnings: string[] = [];
    let acquired = false;
    const competitor = acquireLock(tmpDir, (m) => warnings.push(m), {
      staleThresholdMs: 250,
    }).then((r) => {
      acquired = true;
      return r;
    });

    // Hold well past the stale threshold — the competitor must still be waiting.
    await sleep(600);
    expect(acquired).toBe(false);
    expect(warnings.some((w) => w.includes('stale'))).toBe(false);
    expect(readLockFile().holderId).toBe(holderId);
    expect(release.isLost()).toBe(false);

    release();
    const release2 = await competitor;
    expect(acquired).toBe(true);
    release2();
  });

  it('deleteLockIfUnchanged removes only the exact judged-dead lock', () => {
    // Same-process tests cannot interleave the synchronous judge→delete
    // sequence, so the narrowed-TOCTOU contract (lesson-b813e60b) is locked
    // at the helper boundary.
    const stale = { pid: 12345, timestamp: 1000, createdAt: 1000, holderId: 'dead-holder' };
    fs.writeFileSync(lockFile, JSON.stringify(stale));
    deleteLockIfUnchanged(lockFile, stale);
    expect(fs.existsSync(lockFile)).toBe(false);

    // A peer's fresh lock landing after the judgment must survive.
    const fresh = { pid: 999, timestamp: Date.now(), createdAt: Date.now(), holderId: 'thief' };
    fs.writeFileSync(lockFile, JSON.stringify(fresh));
    deleteLockIfUnchanged(lockFile, stale);
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(readLockFile().holderId).toBe('thief');
  });

  it('theft latches isLost, stops all writes, and warns loudly', async () => {
    const warnings: string[] = [];
    const release = await acquireLock(tmpDir, (m) => warnings.push(m), {
      heartbeatIntervalMs: 25,
    });

    const foreign = { pid: 424242, timestamp: 777, createdAt: 777, holderId: 'foreign-holder' };
    fs.writeFileSync(lockFile, JSON.stringify(foreign));

    await sleep(200); // several beat intervals
    expect(release.isLost()).toBe(true);
    expect(warnings.some((w) => w.includes('taken over'))).toBe(true);
    // Zero writes after detection — the foreign lock is byte-identical.
    expect(readLockFile()).toEqual(foreign);

    // Release must leave the thief's valid lock in place.
    release();
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(readLockFile()).toEqual(foreign);
  });

  it('release does not unlink a lock it no longer owns (no cascade theft)', async () => {
    const warnings: string[] = [];
    // Beat far in the future: theft is discovered at release time, not by a beat.
    const release = await acquireLock(tmpDir, (m) => warnings.push(m), {
      heartbeatIntervalMs: 60_000,
    });
    const foreign = {
      pid: process.pid,
      timestamp: Date.now(),
      createdAt: Date.now(),
      holderId: 'foreign-holder',
    };
    fs.writeFileSync(lockFile, JSON.stringify(foreign));

    release();
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(readLockFile().holderId).toBe('foreign-holder');
    expect(release.isLost()).toBe(true);
    expect(warnings.some((w) => w.includes('taken over'))).toBe(true);
  });

  it('a failing heartbeat write warns once and keeps the hold healthy', async () => {
    const warnings: string[] = [];
    const release = await acquireLock(tmpDir, (m) => warnings.push(m), {
      heartbeatIntervalMs: 25,
    });
    // The beat's temp path is now a directory: every temp write EISDIRs.
    fs.mkdirSync(path.join(tmpDir, `sync.lock.${process.pid}.hb`));

    await sleep(200);
    const hbWarnings = warnings.filter((w) => w.includes('heartbeat write failed'));
    expect(hbWarnings).toHaveLength(1); // warn-once, not once per beat
    expect(release.isLost()).toBe(false);

    release();
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it('a vanished lock file is reclaimed atomically by the next beat', async () => {
    const release = await acquireLock(tmpDir, undefined, { heartbeatIntervalMs: 25 });
    const holderId = readLockFile().holderId;
    fs.unlinkSync(lockFile);

    await sleep(200);
    expect(fs.existsSync(lockFile)).toBe(true);
    expect(readLockFile().holderId).toBe(holderId);
    expect(release.isLost()).toBe(false);
    release();
  });

  it('release stops the heartbeat — no ghost beats touch a successor hold', async () => {
    const release = await acquireLock(tmpDir, undefined, { heartbeatIntervalMs: 25 });
    release();

    const release2 = await acquireLock(tmpDir, undefined, { heartbeatIntervalMs: 60_000 });
    const before = fs.readFileSync(lockFile, 'utf-8');
    await sleep(200);
    expect(fs.readFileSync(lockFile, 'utf-8')).toBe(before);
    release2();
  });

  it('a fresh legacy-shape lock (pre-#2564) blocks, then ages into stealable', async () => {
    // Legacy binaries never heartbeat, so their locks age out exactly as
    // before — the compat contract is "no special-casing in either direction".
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));

    const warnings: string[] = [];
    const release = await acquireLock(tmpDir, (m) => warnings.push(m), {
      staleThresholdMs: 300,
    });
    // It had to wait out the threshold (blocked while fresh), then steal.
    expect(warnings.some((w) => w.includes('stale'))).toBe(true);
    expect(typeof readLockFile().holderId).toBe('string');
    release();
  });
});
