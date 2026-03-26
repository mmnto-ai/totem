import * as path from 'node:path';

import { globSync } from 'glob';

import type { IngestTarget } from '../config-schema.js';
import { DEFAULT_IGNORE_PATTERNS } from '../config-schema.js';
import { safeExec } from '../sys/exec.js';

export interface ResolvedFile {
  absolutePath: string;
  relativePath: string;
  target: IngestTarget;
}

/**
 * Parse null-delimited git output into normalized forward-slash paths.
 */
function parseGitPaths(output: string): string[] {
  return output
    .split('\0')
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'));
}

/**
 * Get the set of non-gitignored files in the project.
 * Includes files inside git submodules via --recurse-submodules.
 * Returns null if git is unavailable or the project is not a git repo.
 */
function getGitNonIgnoredFiles(
  projectRoot: string,
  onWarn?: (msg: string) => void,
): Set<string> | null {
  const execOpts = { cwd: projectRoot };

  try {
    // Parent repo: tracked + untracked (non-ignored) files
    const output = safeExec(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      execOpts,
    );
    const files = new Set(parseGitPaths(output));

    // Submodules: --recurse-submodules only supports --cached,
    // but submodule files we care about are always committed.
    try {
      const subOutput = safeExec(
        'git',
        ['ls-files', '-z', '--cached', '--recurse-submodules'],
        execOpts,
      );
      for (const f of parseGitPaths(subOutput)) {
        files.add(f);
      }
    } catch {
      // --recurse-submodules unsupported or no submodules — ignore
    }

    return files;
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

/** Validate that a git ref is safe (hex SHA, HEAD~N, branch name — no shell metacharacters). */
const SAFE_GIT_REF = /^[a-zA-Z0-9_./:~^{}\-]+$/;

/**
 * Get files changed since a given git ref (e.g., HEAD~1 or a commit SHA).
 * Also includes untracked files so new files are picked up on incremental sync.
 * Uses -z for null-delimited output consistent with getGitNonIgnoredFiles.
 */
export function getChangedFiles(
  projectRoot: string,
  sinceRef: string = 'HEAD~1',
  onWarn?: (msg: string) => void,
): string[] | null {
  if (!SAFE_GIT_REF.test(sinceRef)) {
    if (onWarn) {
      onWarn(`Invalid git ref "${sinceRef}" — falling back to full sync.`);
    }
    return null;
  }

  try {
    const diffOutput = safeExec('git', ['diff', '-z', '--name-only', sinceRef], {
      cwd: projectRoot,
    });

    // Also pick up untracked files (new files not yet committed)
    let untrackedOutput = '';
    try {
      untrackedOutput = safeExec('git', ['ls-files', '-z', '--others', '--exclude-standard'], {
        cwd: projectRoot,
      });
    } catch (err) {
      if (onWarn) {
        onWarn(
          `Failed to list untracked files: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const paths = new Set(
      (diffOutput + untrackedOutput)
        .split('\0')
        .map((p) => p.replace(/\\/g, '/'))
        .filter(Boolean),
    );

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
    return safeExec('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
    });
  } catch (err) {
    if (onWarn) {
      onWarn(`Failed to read HEAD SHA: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}
