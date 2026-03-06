import { execFileSync } from 'node:child_process';
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
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: projectRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32',
      },
    );
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

    for (const rawPath of matches) {
      const relativePath = rawPath.replace(/\\/g, '/');
      if (seen.has(relativePath)) continue;
      if (nonIgnored && !nonIgnored.has(relativePath)) continue;
      seen.add(relativePath);

      results.push({
        absolutePath: path.join(projectRoot, rawPath),
        relativePath,
        target,
      });
    }
  }

  return results;
}

/**
 * Get files changed since a given git ref (e.g., HEAD~1 or a commit SHA).
 * Also includes untracked files so new files are picked up on incremental sync.
 * Used for incremental sync.
 */
export function getChangedFiles(
  projectRoot: string,
  sinceRef: string = 'HEAD~1',
  onWarn?: (msg: string) => void,
): string[] | null {
  try {
    const diffOutput = execFileSync('git', ['diff', '--name-only', sinceRef], {
      cwd: projectRoot,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

    // Also pick up untracked files (new files not yet committed)
    let untrackedOutput = '';
    try {
      untrackedOutput = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: projectRoot,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      });
    } catch (err) {
      if (onWarn) {
        onWarn(
          `Failed to list untracked files: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const paths = new Set<string>();
    for (const line of diffOutput.split('\n')) {
      const trimmed = line.trim().replace(/\\/g, '/');
      if (trimmed) paths.add(trimmed);
    }
    for (const line of untrackedOutput.split('\n')) {
      const trimmed = line.trim().replace(/\\/g, '/');
      if (trimmed) paths.add(trimmed);
    }

    return [...paths];
  } catch (err) {
    const msg = `Failed to get changed files from git. Error: ${err instanceof Error ? err.message : String(err)}`;
    if (onWarn) {
      onWarn(msg);
    }
    return null;
  }
}

/**
 * Get the current HEAD SHA for sync state tracking.
 */
export function getHeadSha(projectRoot: string, onWarn?: (msg: string) => void): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    }).trim();
  } catch (err) {
    if (onWarn) {
      onWarn(`Failed to read HEAD SHA: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}
