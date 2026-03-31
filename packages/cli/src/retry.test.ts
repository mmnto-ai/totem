import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRateLimitError, withRetry } from './retry.js';

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
      baseDelayMs: 100,
      onRetry: (attempt) => {
        retries.push(attempt);
      },
    });

    // Advance well past max jittered delays (100*1.25=125, 200*1.25=250)
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);

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

    let caughtErr: Error | undefined;
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 100 }).catch((err: Error) => {
      caughtErr = err;
    });

    // Advance well past max jittered delays
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);

    await promise;
    expect(caughtErr).toBeDefined();
    expect(caughtErr!.message).toContain('429');
    expect(calls).toBe(3);
  });

  it('calls onRetry callback with attempt and delay', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls <= 3) return Promise.reject(new Error('rate limit exceeded'));
      return Promise.resolve('done');
    };

    const retryArgs: { attempt: number }[] = [];
    const promise = withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      onRetry: (attempt) => {
        retryArgs.push({ attempt });
      },
    });

    // Advance well past all jittered delays
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(800);

    await promise;
    expect(retryArgs.length).toBe(3);
    expect(retryArgs[0]!.attempt).toBe(1);
    expect(retryArgs[1]!.attempt).toBe(2);
    expect(retryArgs[2]!.attempt).toBe(3);
  });

  it('detects rate limit messages case-insensitively', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('Too Many Requests'));
      return Promise.resolve('ok');
    };

    const promise = withRetry(fn, { baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
});

describe('isRateLimitError', () => {
  it('detects 429 status code in message', () => {
    expect(isRateLimitError(new Error('HTTP 429'))).toBe(true);
  });

  it('detects Too Many Requests', () => {
    expect(isRateLimitError(new Error('too many requests'))).toBe(true);
  });

  it('rejects non-rate-limit errors', () => {
    expect(isRateLimitError(new Error('ENOENT'))).toBe(false);
  });

  it('rejects non-Error values', () => {
    expect(isRateLimitError('string')).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});
