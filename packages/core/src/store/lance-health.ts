import type * as lancedb from '@lancedb/lancedb';

import type { Embedder } from '../embedders/embedder.js';
import type { HealthCheckResult, SearchOptions, SearchResult } from '../types.js';

/**
 * Run a health check against the index, verifying dimensions, search, and FTS.
 *
 * @param table - The LanceDB table (may be null if not yet created)
 * @param embedder - The active embedder (used for dimension comparison)
 * @param searchFn - A function that performs a search (used for the canary probe)
 * @param detectFtsIndexFn - A function that detects FTS index availability
 * @param getFtsStatus - A function that returns the current FTS availability flag
 */
export async function runHealthCheck(
  table: lancedb.Table | null,
  embedder: Embedder,
  searchFn: (options: SearchOptions) => Promise<SearchResult[]>,
  detectFtsIndexFn: () => Promise<void>,
  getFtsStatus: () => boolean,
): Promise<HealthCheckResult> {
  const start = Date.now();
  const issues: string[] = [];

  let totalChunks = 0;
  let storedDimensions: number | null = null;
  let dimensionMatch = false;
  let canarySearchOk = false;
  let ftsAvailable = false;
  const expectedDimensions = embedder.dimensions;

  // 1. Count rows and check dimensions
  try {
    if (table) {
      totalChunks = await table.countRows();

      if (totalChunks > 0) {
        // Read one row to get stored vector dimensions
        const rows = await table.query().select(['vector']).limit(1).toArray();
        if (rows.length > 0) {
          const raw = rows[0]!['vector'];
          // LanceDB may return Arrow FixedSizeList — coerce to plain array
          const vec = Array.isArray(raw)
            ? raw
            : raw && typeof (raw as { toArray?: () => number[] }).toArray === 'function'
              ? (raw as { toArray: () => number[] }).toArray()
              : raw && typeof (raw as { length?: number }).length === 'number'
                ? Array.from(raw as ArrayLike<number>)
                : null;
          if (vec) {
            storedDimensions = vec.length;
            dimensionMatch = storedDimensions === expectedDimensions;
            if (!dimensionMatch) {
              issues.push(
                `Dimension mismatch: embedder expects ${expectedDimensions} but stored vectors have ${storedDimensions}`,
              );
            }
          } else {
            issues.push('Could not read vector column from stored row');
          }
        }
      } else {
        // Empty table — dimensions can't be verified but that's OK
        dimensionMatch = true;
      }
    } else {
      // No table — treat as empty, still healthy
      dimensionMatch = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Dimension check failed: ${msg}`);
  }

  // 2. Canary search — embed a probe string and run a search
  try {
    if (table && totalChunks > 0) {
      await searchFn({ query: 'totem health check canary', maxResults: 1, hybrid: false });
      canarySearchOk = true;
    } else {
      // No data to search — canary is trivially OK
      canarySearchOk = true;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`Canary search failed: ${msg}`);
  }

  // 3. FTS availability
  try {
    await detectFtsIndexFn();
    ftsAvailable = getFtsStatus();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    issues.push(`FTS detection failed: ${msg}`);
  }

  const durationMs = Date.now() - start;
  const healthy = issues.length === 0;

  return {
    healthy,
    durationMs,
    totalChunks,
    expectedDimensions,
    storedDimensions,
    dimensionMatch,
    canarySearchOk,
    ftsAvailable,
    issues,
  };
}
