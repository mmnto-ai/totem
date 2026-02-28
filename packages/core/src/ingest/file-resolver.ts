import { globSync } from 'glob';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import type { IngestTarget } from '../config-schema.js';

export interface ResolvedFile {
  absolutePath: string;
  relativePath: string;
  target: IngestTarget;
}

/** Resolve glob patterns from config targets to actual file paths. */
export function resolveFiles(
  targets: IngestTarget[],
  projectRoot: string,
): ResolvedFile[] {
  const results: ResolvedFile[] = [];
  const seen = new Set<string>();

  for (const target of targets) {
    const matches = globSync(target.glob, {
      cwd: projectRoot,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.lancedb/**', '**/dist/**'],
    });

    for (const relativePath of matches) {
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);

      results.push({
        absolutePath: path.join(projectRoot, relativePath),
        relativePath,
        target,
      });
    }
  }

  return results;
}

/**
 * Get files changed since a given git ref (e.g., HEAD~1 or a commit SHA).
 * Used for incremental sync.
 */
export function getChangedFiles(
  projectRoot: string,
  sinceRef: string = 'HEAD~1',
): string[] {
  try {
    const output = execSync(`git diff --name-only ${sinceRef}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
    });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    console.warn(
      `[Totem Warning] Failed to get changed files from git, skipping incremental sync. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
