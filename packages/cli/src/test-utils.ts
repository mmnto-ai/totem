import * as fs from 'node:fs';

/**
 * Remove a temporary directory with retry semantics for Windows ENOTEMPTY flakes.
 * Safe to call with falsy paths (no-op).
 */
export function cleanTmpDir(dir: string | undefined): void {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
