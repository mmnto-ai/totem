import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withRetry } from './retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('retries on 429 and succeeds', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls <= 2) return Promise.reject(new Error('429 Too Many Requests'));
      return Promise.resolve('recovered');
    };

    const retries: number[] = [];
    const promise = withRetry(fn, {
      baseDelayMs: 1000,
      onRetry: (attempt) => {
        retries.push(attempt);
      },
    });

    // Advance through the two retry delays
    await vi.advanceTimersByTimeAsync(1000); // first retry: 1000ms * 2^0
    await vi.advanceTimersByTimeAsync(2000); // second retry: 1000ms * 2^1

    const result = await promise;
    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('throws non-429 errors immediately', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.reject(new Error('ENOENT: file not found'));
    };

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });

  it('throws after max retries exhausted', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return Promise.reject(new Error('429 Too Many Requests'));
    };

    // Attach rejection handler immediately to avoid unhandled rejection warning
    let caughtErr: Error | undefined;
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 100 }).catch((err: Error) => {
      caughtErr = err;
    });

    // Advance through both retry delays
    await vi.advanceTimersByTimeAsync(100); // retry 1: 100 * 2^0
    await vi.advanceTimersByTimeAsync(200); // retry 2: 100 * 2^1

    await promise;
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.message).toContain('429');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('calls onRetry callback with attempt and delay', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls <= 3) return Promise.reject(new Error('rate limit exceeded'));
      return Promise.resolve('done');
    };

    const retryArgs: { attempt: number; delay: number }[] = [];
    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 500,
      onRetry: (attempt, delayMs) => {
        retryArgs.push({ attempt, delay: delayMs });
      },
    });

    await vi.advanceTimersByTimeAsync(500); // retry 1: 500 * 2^0 = 500
    await vi.advanceTimersByTimeAsync(1000); // retry 2: 500 * 2^1 = 1000
    await vi.advanceTimersByTimeAsync(2000); // retry 3: 500 * 2^2 = 2000

    await promise;
    expect(retryArgs).toEqual([
      { attempt: 1, delay: 500 },
      { attempt: 2, delay: 1000 },
      { attempt: 3, delay: 2000 },
    ]);
  });

  it('detects rate limit messages case-insensitively by content', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('Too Many Requests'));
      return Promise.resolve('ok');
    };

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});
