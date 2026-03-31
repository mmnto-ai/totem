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

  it('calculates accurate ETA from active item durations', () => {
    const tracker = new ProgressTracker(10);
    // Tick 5 items with 2000ms each
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(2000);
      tracker.tick(2000);
    }
    const output = tracker.format();
    expect(output).toContain('5/10');
    expect(output).toContain('50%');
    expect(output).toContain('remaining');
    // 5 remaining * 2000ms avg = 10s remaining
    expect(output).toContain('~10s remaining');
  });

  it('excludes instant items from ETA calculation', () => {
    const tracker = new ProgressTracker(10);
    // Tick 3 cached items (< 500ms, excluded from average)
    vi.advanceTimersByTime(100);
    tracker.tick(100);
    tracker.tick(200);
    tracker.tick(50);
    // No active times recorded, should still say "calculating"
    const outputNoActive = tracker.format();
    expect(outputNoActive).toContain('3/10');
    expect(outputNoActive).toContain('calculating ETA');

    // Now tick one real item
    vi.advanceTimersByTime(3000);
    tracker.tick(3000);
    const output = tracker.format();
    expect(output).toContain('4/10');
    expect(output).toContain('remaining');
    // 6 remaining * 3000ms avg = 18s
    expect(output).toContain('~18s remaining');
  });

  it('shows no remaining when all complete', () => {
    const tracker = new ProgressTracker(3);
    vi.advanceTimersByTime(1000);
    tracker.tick(1000);
    vi.advanceTimersByTime(1000);
    tracker.tick(1000);
    vi.advanceTimersByTime(1000);
    tracker.tick(1000);
    const output = tracker.format();
    expect(output).toContain('3/3');
    expect(output).toContain('100%');
    expect(output).toContain('elapsed');
    expect(output).not.toContain('remaining');
    expect(output).not.toContain('calculating');
  });

  it('tracks completedCount correctly', () => {
    const tracker = new ProgressTracker(5);
    expect(tracker.completedCount).toBe(0);
    tracker.tick(1000);
    tracker.tick();
    expect(tracker.completedCount).toBe(2);
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
