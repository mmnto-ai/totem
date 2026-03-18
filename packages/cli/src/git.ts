import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

import { TotemGitError } from '@mmnto/totem';

import { IS_WIN } from './utils.js';

// ─── Constants ──────────────────────────────────────────

const GIT_COMMAND_TIMEOUT_MS = 15_000;

function throwIfGitMissing(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ENOENT') || msg.includes('not found')) {
    throw new TotemGitError(
      "'git' command not found.",
      'Ensure Git is installed and in your PATH.',
    );
  }
}

// ─── Git helpers ────────────────────────────────────────

export function getGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf-8',
      shell: IS_WIN,
    }).trim();
  } catch {
    return '(unknown)';
  }
}

export function getGitStatus(cwd: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

export function getGitDiff(mode: 'staged' | 'all', cwd: string): string {
  const args = mode === 'staged' ? ['diff', '--staged'] : ['diff', 'HEAD'];
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    });
  } catch (err) {
    throwIfGitMissing(err);
    const msg = err instanceof Error ? err.message : String(err);
    throw new TotemGitError(
      `Failed to get git diff: ${msg}`,
      'Check that you are inside a Git repository with at least one commit.',
    );
  }
}

export function getGitDiffStat(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD', '--stat'], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Detect the default branch of the remote (e.g. main, master).
 * Falls back to 'main' if detection fails.
 */
export function getDefaultBranch(cwd: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
    // ref is like "origin/main" — strip the remote prefix
    return ref.replace(/^origin\//, '');
  } catch (err) {
    throwIfGitMissing(err);

    // Fallback: check local then remote refs for 'main' / 'master'
    for (const branch of ['main', 'master']) {
      for (const ref of [branch, `origin/${branch}`]) {
        try {
          execFileSync('git', ['rev-parse', '--verify', ref], {
            cwd,
            encoding: 'utf-8',
            timeout: GIT_COMMAND_TIMEOUT_MS,
            shell: IS_WIN,
          });
          return branch;
        } catch {
          // Try next candidate
        }
      }
    }
    throw new TotemGitError(
      "Could not determine default branch. Neither 'main' nor 'master' found locally, and 'git symbolic-ref' failed.",
      "Run 'git remote set-head origin --auto' to configure the default branch, or pass --base explicitly.",
    );
  }
}

export function getGitBranchDiff(cwd: string, base?: string): string {
  const baseBranch = base ?? getDefaultBranch(cwd);
  // Try local ref first, then remote — CI may only have origin/<branch>
  const refs = [baseBranch, `origin/${baseBranch}`];
  for (const ref of refs) {
    try {
      return execFileSync('git', ['diff', `${ref}...HEAD`], {
        cwd,
        encoding: 'utf-8',
        timeout: GIT_COMMAND_TIMEOUT_MS,
        shell: IS_WIN,
      });
    } catch (err) {
      throwIfGitMissing(err);
      // If this was the last ref, throw
      if (ref === refs[refs.length - 1]) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TotemGitError(
          `Failed to get branch diff (${baseBranch}...HEAD): ${msg}`,
          `Ensure the base branch '${baseBranch}' exists locally or as a remote ref. Try 'git fetch origin ${baseBranch}'.`,
        );
      }
    }
  }
  // Unreachable — loop always returns or throws
  return '';
}

/**
 * Get the author date of a tag in YYYY-MM-DD format.
 * Returns null if tag doesn't exist or lookup fails.
 */
export function getTagDate(cwd: string, tag: string): string | null {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%aI', tag], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
    return date.slice(0, 10) || null;
  } catch {
    return null;
  }
}

/**
 * Get the most recent semver tag (e.g., "v0.14.0").
 * Returns null if no tags exist.
 */
export function getLatestTag(cwd: string): string | null {
  try {
    return (
      execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
        cwd,
        encoding: 'utf-8',
        timeout: GIT_COMMAND_TIMEOUT_MS,
        shell: IS_WIN,
      }).trim() || null
    );
  } catch {
    return null;
  }
}

/**
 * Get git log since a ref (tag or commit), or last N commits as fallback.
 * Returns one-line-per-commit format: "hash subject".
 */
export function getGitLogSince(cwd: string, since?: string, maxCommits = 50): string {
  const args = since
    ? ['log', `${since}..HEAD`, '--oneline', `--max-count=${maxCommits}`]
    : ['log', '--oneline', `-${maxCommits}`];
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Check if a specific file has uncommitted changes (staged or unstaged).
 */
export function isFileDirty(cwd: string, filePath: string): boolean {
  try {
    const output = execFileSync('git', ['status', '--porcelain', '--', filePath], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolve the git repository root from any subdirectory.
 * Returns the normalized absolute path, or null if not in a git repo.
 */
export function resolveGitRoot(cwd: string): string | null {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
    // git returns forward slashes even on Windows — normalize for fs operations
    return path.normalize(root);
  } catch {
    return null;
  }
}

/**
 * Filter a unified diff to exclude files matching ignore patterns.
 * Splits on `diff --git` boundaries and removes sections for ignored files.
 * Uses matchesGlob from core for consistent glob behavior.
 */
export async function filterDiffByPatterns(diff: string, patterns: string[]): Promise<string> {
  if (patterns.length === 0) return diff;

  const { matchesGlob } = await import('@mmnto/totem');

  const sections = diff.split(/^(?=diff --git )/m);
  return sections
    .filter((section) => {
      // Extract destination path (b/) — handles renames correctly
      const firstLine = section.substring(0, section.indexOf('\n'));
      const quoted = firstLine.match(/^diff --git "a\/.*?" "b\/(.*?)"$/);
      const unquoted = firstLine.match(/^diff --git a\/\S+ b\/(.+)$/);
      const filePath = quoted?.[1] ?? unquoted?.[1];
      if (!filePath) return true;
      return !patterns.some((p) => matchesGlob(filePath, p));
    })
    .join(''); // totem-ignore (#669) — joining diff sections, not text fragments
}

export function extractChangedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      // Handle quoted paths (spaces): diff --git "a/my file.ts" "b/my file.ts"
      const quoted = line.match(/^diff --git "a\/.+" "b\/(.+)"$/); // totem-ignore — single line match, not iterating
      if (quoted) {
        files.push(quoted[1]!);
        continue;
      }
      // Standard unquoted paths: diff --git a/file.ts b/file.ts
      const unquoted = line.match(/^diff --git a\/.+ b\/(.+)$/); // totem-ignore — single line match
      if (unquoted) files.push(unquoted[1]!);
    }
  }
  return files;
}
