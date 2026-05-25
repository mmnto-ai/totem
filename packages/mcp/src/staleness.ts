/**
 * Relative-time formatter for the MCP index-state envelope (mmnto-ai/totem#2029).
 *
 * Computes a human-readable staleness string from an ISO-8601 timestamp,
 * e.g. "5 minutes ago", "3 hours ago", "2 days ago". Prefixes "STALE: "
 * when the timestamp exceeds the staleness threshold (default 7 days).
 *
 * Pure function — no filesystem reads, no I/O. The `now` parameter is
 * injectable for deterministic testing.
 */

/** Days threshold beyond which the STALE: prefix is applied. */
export const STALE_THRESHOLD_DAYS = 7;

/**
 * Format an ISO-8601 timestamp as a human-readable staleness string.
 *
 * Returns null when the input is null OR fails to parse — callers treat
 * null as "no index timestamp available" (honest absence per Tenet 14).
 *
 * Future timestamps (clock skew) return 'just synced' rather than a
 * negative-duration string — safer for Docker/VM clock-drift environments
 * where small forward skews are common.
 */
export function formatStaleness(isoStamp: string | null, now: Date = new Date()): string | null {
  if (isoStamp === null) return null;
  const then = Date.parse(isoStamp);
  if (Number.isNaN(then)) return null;

  const diffMs = now.getTime() - then;
  if (diffMs < 0) return 'just synced';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just synced';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;

  const diffDay = Math.floor(diffHr / 24);
  const stalePrefix = diffDay >= STALE_THRESHOLD_DAYS ? 'STALE: ' : '';

  if (diffDay < 7) return `${stalePrefix}${diffDay} day${diffDay === 1 ? '' : 's'} ago`;

  const diffWk = Math.floor(diffDay / 7);
  if (diffWk < 4) return `${stalePrefix}${diffWk} week${diffWk === 1 ? '' : 's'} ago`;

  return `${stalePrefix}${diffDay} days ago`;
}
