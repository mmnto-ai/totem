import { describe, expect, it } from 'vitest';

import { formatStaleness, STALE_THRESHOLD_DAYS } from './staleness.js';

describe('formatStaleness', () => {
  // Fixed reference time so every case is deterministic.
  const NOW = new Date('2026-05-25T20:00:00.000Z');

  it('returns null when the input is null', () => {
    expect(formatStaleness(null, NOW)).toBeNull();
  });

  it('returns null when the input is not a parseable ISO string', () => {
    expect(formatStaleness('not-a-date', NOW)).toBeNull();
    expect(formatStaleness('', NOW)).toBeNull();
  });

  it('returns "just synced" for timestamps within the last minute', () => {
    expect(formatStaleness('2026-05-25T19:59:30.000Z', NOW)).toBe('just synced');
    expect(formatStaleness('2026-05-25T19:59:01.000Z', NOW)).toBe('just synced');
  });

  it('returns "just synced" for future timestamps (clock-skew safety)', () => {
    expect(formatStaleness('2026-05-25T20:00:30.000Z', NOW)).toBe('just synced');
    expect(formatStaleness('2026-05-26T00:00:00.000Z', NOW)).toBe('just synced');
  });

  it('formats minute-scale staleness with singular/plural agreement', () => {
    expect(formatStaleness('2026-05-25T19:59:00.000Z', NOW)).toBe('1 minute ago');
    expect(formatStaleness('2026-05-25T19:58:00.000Z', NOW)).toBe('2 minutes ago');
    expect(formatStaleness('2026-05-25T19:55:00.000Z', NOW)).toBe('5 minutes ago');
    expect(formatStaleness('2026-05-25T19:01:00.000Z', NOW)).toBe('59 minutes ago');
  });

  it('formats hour-scale staleness with singular/plural agreement', () => {
    expect(formatStaleness('2026-05-25T19:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(formatStaleness('2026-05-25T17:00:00.000Z', NOW)).toBe('3 hours ago');
    expect(formatStaleness('2026-05-24T21:00:00.000Z', NOW)).toBe('23 hours ago');
  });

  it('formats day-scale staleness for under-week durations', () => {
    expect(formatStaleness('2026-05-24T20:00:00.000Z', NOW)).toBe('1 day ago');
    expect(formatStaleness('2026-05-22T20:00:00.000Z', NOW)).toBe('3 days ago');
    expect(formatStaleness('2026-05-20T20:00:00.000Z', NOW)).toBe('5 days ago');
  });

  it('prefixes STALE: at exactly the threshold and beyond (day scale)', () => {
    // 6 days ago → no STALE
    expect(formatStaleness('2026-05-19T20:00:00.000Z', NOW)).toBe('6 days ago');
    // 7 days ago → STALE prefix kicks in (week-scale formatter rounds to 1 week)
    const sevenDaysAgo = new Date(NOW.getTime() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    expect(formatStaleness(sevenDaysAgo.toISOString(), NOW)).toBe('STALE: 1 week ago');
  });

  it('formats week-scale staleness with STALE prefix and plural agreement', () => {
    expect(formatStaleness('2026-05-18T20:00:00.000Z', NOW)).toBe('STALE: 1 week ago');
    expect(formatStaleness('2026-05-11T20:00:00.000Z', NOW)).toBe('STALE: 2 weeks ago');
    expect(formatStaleness('2026-05-04T20:00:00.000Z', NOW)).toBe('STALE: 3 weeks ago');
  });

  it('falls back to day-count formatting for staleness beyond 4 weeks', () => {
    expect(formatStaleness('2026-04-25T20:00:00.000Z', NOW)).toBe('STALE: 30 days ago');
    expect(formatStaleness('2025-11-25T20:00:00.000Z', NOW)).toBe('STALE: 181 days ago');
  });

  it('uses real-time now when the now parameter is omitted', () => {
    // Smoke test: invocation without explicit now must not throw and must
    // return a non-null result for a past timestamp.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const result = formatStaleness(yesterday);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });
});
