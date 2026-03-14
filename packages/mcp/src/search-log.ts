import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SearchLogEntry {
  timestamp: string;
  query: string;
  typeFilter?: string;
  resultCount: number;
  durationMs: number;
  topScore: number | null;
  error?: string;
}

export interface SearchStats {
  totalCalls: number;
  avgDuration: number;
  avgTopScore: number;
}

/** In-memory log of search calls for the current server session. */
const entries: SearchLogEntry[] = [];

/** Resolved path to the JSONL log file, set on first logSearch call. */
let logFilePath: string | undefined;

/**
 * Set the directory where the `.search-log.jsonl` file will be written.
 * Must be called before the first `logSearch` to enable file logging.
 */
export function setLogDir(totemDir: string): void {
  logFilePath = path.join(totemDir, '.search-log.jsonl');
}

/**
 * Record a search call.
 *
 * - Always appends to the in-memory array.
 * - Best-effort appends a single JSON line to `{totemDir}/.search-log.jsonl`.
 *   File writes are fire-and-forget — failures are silently swallowed because
 *   writing to stdout/stderr would corrupt the MCP stdio transport.
 */
export function logSearch(entry: SearchLogEntry): void {
  entries.push(entry);

  // Best-effort, non-blocking file append
  if (logFilePath) {
    try {
      const line = JSON.stringify(entry) + '\n';
      // fs.promises.appendFile returns a promise — we intentionally do NOT await it.
      // The .catch() swallows any write error silently (no stdout/stderr writes).
      fs.promises.appendFile(logFilePath, line, 'utf-8').catch(() => {
        // Intentionally empty — must not write to stdout/stderr (MCP stdio transport)
      });
    } catch {
      // Intentionally empty — synchronous errors from JSON.stringify etc.
    }
  }
}

/**
 * Compute aggregate stats from the in-memory search log.
 */
export function getSearchStats(): SearchStats {
  const totalCalls = entries.length;

  if (totalCalls === 0) {
    return { totalCalls: 0, avgDuration: 0, avgTopScore: 0 };
  }

  const avgDuration = entries.reduce((sum, e) => sum + e.durationMs, 0) / totalCalls;

  const scored = entries.filter((e) => e.topScore !== null);
  const avgTopScore =
    scored.length > 0 ? scored.reduce((sum, e) => sum + e.topScore!, 0) / scored.length : 0;

  return { totalCalls, avgDuration, avgTopScore };
}
