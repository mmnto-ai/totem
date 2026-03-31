import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDuration, ProgressTracker } from './progress.js';

describe('ProgressTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns calculating state when zero items completed', () => {
    const tracker = new ProgressTracker(10);
    const output = tracker.format();
    expect(output).toContain('0/10');
    expect(output).toContain('0%');
    expect(output).toContain('calculating ETA');
  });

  it('calculates ETA using throughput', () => {
    const tracker = new ProgressTracker(10);
    // Complete 5 items over 10 seconds = 0.5 items/sec
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2000);
      tracker.tick();
    }
    const output = tracker.format();
    expect(output).toContain('5/10');
    expect(output).toContain('50%');
    // 5 remaining at 0.5 items/sec = 10s
    expect(output).toContain('~10s remaining');
  });

  it('shows no remaining when all complete', () => {
    const tracker = new ProgressTracker(3);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000);
      tracker.tick();
    }
    const output = tracker.format();
    expect(output).toContain('3/3');
    expect(output).toContain('100%');
    expect(output).toContain('elapsed');
    expect(output).not.toContain('remaining');
  });

  it('tracks completedCount correctly', () => {
    const tracker = new ProgressTracker(5);
    expect(tracker.completedCount).toBe(0);
    tracker.tick();
    tracker.tick();
    expect(tracker.completedCount).toBe(2);
  });

  it('handles total of zero without division error', () => {
    const tracker = new ProgressTracker(0);
    const output = tracker.format();
    expect(output).toContain('0/0');
    expect(output).toContain('0%');
  });
});

describe('formatDuration', () => {
  it('formats seconds only for < 60s', () => {
    expect(formatDuration(45_000)).toBe('45s');
  });

  it('formats minutes and seconds for 90s', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('formats minutes and seconds for 125s', () => {
    expect(formatDuration(125_000)).toBe('2m 5s');
  });

  it('formats exact minutes without seconds', () => {
    expect(formatDuration(120_000)).toBe('2m');
  });

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});
