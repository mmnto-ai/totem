import * as path from 'node:path';

import { matchesGlob } from '../compiler.js';
import { TotemGitError } from '../errors.js';
import { safeExec } from './exec.js';

// ─── Constants ──────────────────────────────────────────

const GIT_COMMAND_TIMEOUT_MS = 15_000;
const GIT_DIFF_MAX_BUFFER = 10 * 1024 * 1024; // 10MB — large diffs (e.g., compiled-rules.json)

/**
 * Bound on the cause-chain walk in {@link containsNotAGitRepo}. Errors produced
 * by `safeExec` wrap git stderr one level deep; we allow extra headroom in case
 * a caller adds its own wrapping layer, but refuse to walk an unbounded chain.
 */
const ERROR_CAUSE_WALK_MAX_DEPTH = 8;

function throwIfGitMissing(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ENOENT') || msg.includes('not found')) {
    throw new TotemGitError(
      "'git' command not found.",
      'Ensure Git is installed and in your PATH.',
      err,
    );
  }
}

// ─── Git helpers ────────────────────────────────────────

export function getGitBranch(cwd: string): string {
  try {
    return safeExec('git', ['branch', '--show-current'], { cwd });
  } catch {
    // totem-context: best-effort display query — caller surfaces "(unknown)" when git is unavailable, so fail-open is the documented contract (mmnto/totem#1440)
    return '(unknown)';
  }
}

export function getGitStatus(cwd: string): string {
  try {
    return safeExec('git', ['status', '--porcelain'], { cwd });
  } catch {
    // totem-context: best-effort status query — caller treats missing git as "no changes" for display purposes only (mmnto/totem#1440)
    return '';
  }
}

export function getGitDiff(mode: 'staged' | 'all', cwd: string): string {
  const args = mode === 'staged' ? ['diff', '--staged'] : ['diff', 'HEAD'];
  try {
    return safeExec('git', args, {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_DIFF_MAX_BUFFER,
    });
  } catch (err) {
    throwIfGitMissing(err);
    const msg = err instanceof Error ? err.message : String(err);
    throw new TotemGitError(
      `Failed to get git diff: ${msg}`,
      'Check that you are inside a Git repository with at least one commit.',
      err,
    );
  }
}

export function getGitDiffStat(cwd: string): string {
  try {
    return safeExec('git', ['diff', 'HEAD', '--stat'], {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
  } catch {
    // totem-context: best-effort diff summary — empty string is a valid "no changes / git unavailable" surface for this cosmetic helper (mmnto/totem#1440)
    return '';
  }
}

/**
 * Detect the default branch of the remote (e.g. main, master).
 * Falls back to 'main' if detection fails.
 */
export function getDefaultBranch(cwd: string): string {
  try {
    const ref = safeExec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    // ref is like "origin/main" — strip the remote prefix
    return ref.replace(/^origin\//, '');
  } catch (err) {
    throwIfGitMissing(err);

    // Fallback: check local then remote refs for 'main' / 'master'
    for (const branch of ['main', 'master']) {
      for (const ref of [branch, `origin/${branch}`]) {
        try {
          safeExec('git', ['rev-parse', '--verify', ref], {
            cwd,
            timeout: GIT_COMMAND_TIMEOUT_MS,
          });
          return branch;
        } catch {
          // totem-context: intentional control flow — probing multiple branch candidates, outer function throws if none match (mmnto/totem#1440)
          // Try next candidate
        }
      }
    }
    throw new TotemGitError(
      "Could not determine default branch. Neither 'main' nor 'master' found locally, and 'git symbolic-ref' failed.",
      "Run 'git remote set-head origin --auto' to configure the default branch, or pass --base explicitly.",
      err,
    );
  }
}

export function getGitBranchDiff(cwd: string, base?: string): string {
  const baseBranch = base ?? getDefaultBranch(cwd);
  // Try local ref first, then remote — CI may only have origin/<branch>
  const refs = [baseBranch, `origin/${baseBranch}`];
  for (const ref of refs) {
    try {
      return safeExec('git', ['diff', `${ref}...HEAD`], {
        cwd,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        maxBuffer: GIT_DIFF_MAX_BUFFER,
      });
    } catch (err) {
      throwIfGitMissing(err);
      // If this was the last ref, throw
      if (ref === refs[refs.length - 1]) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TotemGitError(
          `Failed to get branch diff (${baseBranch}...HEAD): ${msg}`,
          `Ensure the base branch '${baseBranch}' exists locally or as a remote ref. Try 'git fetch origin ${baseBranch}'.`,
          err,
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
    const date = safeExec('git', ['log', '-1', '--format=%aI', tag], {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return date.slice(0, 10) || null;
  } catch {
    // totem-context: best-effort tag lookup — null is the documented "not found / git unavailable" return (mmnto/totem#1440)
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
      safeExec('git', ['describe', '--tags', '--abbrev=0'], {
        cwd,
        timeout: GIT_COMMAND_TIMEOUT_MS,
      }) || null
    );
  } catch {
    // totem-context: best-effort tag lookup — null is the documented "no tags / git unavailable" return (mmnto/totem#1440)
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
    return safeExec('git', args, {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
  } catch {
    // totem-context: best-effort log query — empty string is a valid "no log / git unavailable" surface for briefing/status displays (mmnto/totem#1440)
    return '';
  }
}

/**
 * Check if a specific file has uncommitted changes (staged or unstaged).
 *
 * Fails loud: throws `TotemGitError` when git is absent or errors, so callers
 * cannot mistake "git broke" for "file is clean" (mmnto/totem#1440). The one
 * documented silent-false case is "not a git repository" — a legitimate state
 * for a working directory that happens to sit outside version control.
 * Callers that truly want silent fallback for OTHER git failures must opt in
 * explicitly with their own try/catch + `// totem-context:` annotation.
 */
export function isFileDirty(cwd: string, filePath: string): boolean {
  try {
    const output = safeExec('git', ['status', '--porcelain', '--', filePath], {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    return output.length > 0;
  } catch (err) {
    throwIfGitMissing(err);
    // Narrow-false: mirror the `resolveGitRoot` pattern — "not a git
    // repository" is a legit state, not a bug. Return false there so callers
    // running in non-git contexts don't crash. All other git failures throw.
    if (containsNotAGitRepo(err)) return false;
    throw new TotemGitError(
      `Failed to check dirty status for ${filePath}.`,
      'Ensure you are inside a git repository and the file path is valid.',
      err,
    );
  }
}

/**
 * Resolve the git repository root from any subdirectory.
 * Returns the normalized absolute path when inside a git repo, or `null` only
 * when the directory is genuinely outside any git repo (the documented "not
 * in a git repo" case). Any OTHER git failure — git binary missing, permission
 * error, timeout, corrupted index — throws `TotemGitError` so callers cannot
 * confuse "not a repo" with "git broke" (mmnto/totem#1440).
 */
export function resolveGitRoot(cwd: string): string | null {
  try {
    const root = safeExec('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: GIT_COMMAND_TIMEOUT_MS,
    });
    // git returns forward slashes even on Windows — normalize for fs operations
    return path.normalize(root);
  } catch (err) {
    throwIfGitMissing(err);
    // Narrow-scope null: the only legitimate silent case is "not a git
    // repository". All other failures re-throw so callers cannot confuse
    // "not in a repo" with "git broke while asking." Walk the cause chain
    // because safeExec wraps the git stderr inside `err.cause` while the
    // outer `err.message` is a generic "Command failed: git rev-parse ..."
    // wrapper.
    if (containsNotAGitRepo(err)) return null;
    throw new TotemGitError(
      'Failed to resolve git root.',
      'Check that the working directory is accessible and git is functional.',
      err,
    );
  }
}

function containsNotAGitRepo(err: unknown): boolean {
  let cursor: unknown = err;
  // Walk the cause chain up to `ERROR_CAUSE_WALK_MAX_DEPTH` hops. Coerce each
  // cursor to string via `.message` when available and `String(cursor)`
  // otherwise so a cause that is a plain string or object (e.g., raw stderr
  // surfaced via `Error.cause = stderrString`) still gets matched instead of
  // silently terminating the chain walk.
  for (let depth = 0; depth < ERROR_CAUSE_WALK_MAX_DEPTH && cursor != null; depth += 1) {
    const msg = cursor instanceof Error ? cursor.message : String(cursor);
    if (/not a git repository/i.test(msg)) return true;
    cursor = cursor instanceof Error ? cursor.cause : null;
  }
  return false;
}

/**
 * Filter a unified diff to exclude files matching ignore patterns.
 * Splits on `diff --git` boundaries and removes sections for ignored files.
 * Uses matchesGlob from core for consistent glob behavior.
 */
export function filterDiffByPatterns(diff: string, patterns: string[]): string {
  if (patterns.length === 0) return diff;

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

// ─── Scope inference ───────────────────────────────────

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go']);

/**
 * Infer a scope glob suggestion from a list of changed file paths.
 * Returns glob patterns based on the common directory prefix,
 * with default test file exclusions.
 */
export function inferScopeFromFiles(files: string[]): string[] {
  // Filter to source code files only (ignore configs, docs, data files)
  const codeFiles = files.filter((f) => {
    const dot = f.lastIndexOf('.');
    if (dot === -1) return false;
    return CODE_EXTENSIONS.has(f.slice(dot).toLowerCase());
  });

  if (codeFiles.length === 0) return [];

  // Compute common directory prefix
  const dirs = codeFiles.map((f) => {
    const slash = f.lastIndexOf('/');
    return slash === -1 ? '' : f.slice(0, slash);
  });

  let prefix = dirs[0]!;
  for (let i = 1; i < dirs.length; i++) {
    while (prefix && dirs[i] !== prefix && !dirs[i]!.startsWith(prefix + '/')) {
      const slash = prefix.lastIndexOf('/');
      prefix = slash === -1 ? '' : prefix.slice(0, slash);
    }
    if (!prefix) break;
  }

  // No useful common prefix — files are scattered across the repo.
  // Root-level files (prefix === '') also return empty — too broad to be useful.
  if (!prefix) return [];

  // Determine dominant extension
  const extCounts = new Map<string, number>();
  for (const f of codeFiles) {
    const dot = f.lastIndexOf('.');
    const ext = f.slice(dot).toLowerCase();
    extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
  }
  let dominantExt = '';
  let maxCount = 0;
  for (const [ext, count] of extCounts) {
    if (count > maxCount) {
      maxCount = count;
      dominantExt = ext;
    }
  }

  return [`${prefix}/**/*${dominantExt}`, '!**/*.test.*', '!**/*.spec.*'];
}
