import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestPacer } from './pacing.js';

describe('createRequestPacer (#2562)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureWaits(): (number | undefined)[] {
    const delays: (number | undefined)[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as never);
    return delays;
  }

  it('a zero/negative interval is a no-op — zero added latency', async () => {
    const delays = captureWaits();
    for (const pacer of [createRequestPacer(0), createRequestPacer(-5)]) {
      await pacer();
      await pacer();
    }
    expect(delays).toHaveLength(0);
  });

  it('the first paced call never waits', async () => {
    const delays = captureWaits();
    const pace = createRequestPacer(10_000);
    await pace();
    expect(delays).toHaveLength(0);
  });

  it('a rapid successor waits out the remaining interval', async () => {
    const delays = captureWaits();
    const pace = createRequestPacer(10_000);
    await pace();
    await pace();
    expect(delays).toHaveLength(1);
    expect(delays[0]!).toBeGreaterThan(0);
    expect(delays[0]!).toBeLessThanOrEqual(10_000);
  });

  it('a successor arriving after the interval passes through without waiting', async () => {
    const delays = captureWaits();
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const pace = createRequestPacer(50);
    await pace();
    now += 60; // beyond the 50ms interval
    await pace();
    expect(delays).toHaveLength(0);
  });
});
