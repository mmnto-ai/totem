import { execSync } from 'node:child_process';
import * as path from 'node:path';

import { globSync } from 'glob';

import type { IngestTarget } from '../config-schema.js';
import { DEFAULT_IGNORE_PATTERNS } from '../config-schema.js';

export interface ResolvedFile {
  absolutePath: string;
  relativePath: string;
  target: IngestTarget;
}

/**
 * Get the set of non-gitignored files in the project.
 * Returns null if git is unavailable or the project is not a git repo.
 */
function getGitNonIgnoredFiles(
  projectRoot: string,
  onWarn?: (msg: string) => void,
): Set<string> | null {
  try {
    const output = execSync('git ls-files -z --cached --others --exclude-standard', {
      cwd: projectRoot,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return new Set(
      output
        .split('\0')
        .filter(Boolean)
        .map((f) => f.replace(/\\/g, '/')),
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const msg =
      errorMsg.includes('ENOENT') || errorMsg.includes('not found')
        ? `Command 'git' not found. Cannot use .gitignore for filtering. Falling back to ignorePatterns only.`
        : `Could not read git index for .gitignore filtering. Falling back to ignorePatterns only. Error: ${errorMsg}`;
    if (onWarn) {
      onWarn(msg);
    } else {
      console.warn(`[Totem Warning] ${msg}`);
    }
    return null;
  }
}

/** Resolve glob patterns from config targets to actual file paths. */
export function resolveFiles(
  targets: IngestTarget[],
  projectRoot: string,
  ignorePatterns: string[] = DEFAULT_IGNORE_PATTERNS,
  onWarn?: (msg: string) => void,
): ResolvedFile[] {
  const results: ResolvedFile[] = [];
  const seen = new Set<string>();
  const nonIgnored = getGitNonIgnoredFiles(projectRoot, onWarn);

  for (const target of targets) {
    const matches = globSync(target.glob, {
      cwd: projectRoot,
      nodir: true,
      ignore: ignorePatterns,
    });

    for (const relativePath of matches) {
      const normalized = relativePath.replace(/\\/g, '/');
      if (seen.has(normalized)) continue;
      if (nonIgnored && !nonIgnored.has(normalized)) continue;
      seen.add(normalized);

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
  onWarn?: (msg: string) => void,
): string[] | null {
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
    const msg = `Failed to get changed files from git. Error: ${err instanceof Error ? err.message : String(err)}`;
    if (onWarn) {
      onWarn(msg);
    } else {
      console.warn(`[Totem Warning] ${msg}`);
    }
    return null;
  }
}
