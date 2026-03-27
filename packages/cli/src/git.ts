// Pure git utilities — delegated to core, re-exported for backward compatibility
export {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffStat,
  getGitLogSince,
  getGitStatus,
  getLatestTag,
  getTagDate,
  isFileDirty,
  resolveGitRoot,
} from '@mmnto/totem';

import { safeExec } from '@mmnto/totem';

// ─── Incremental shield helpers (#1010) ─────────────────

/**
 * Check if `base` is an ancestor of `head` (or HEAD if omitted).
 * Returns true if `git merge-base --is-ancestor` exits 0.
 */
export function isAncestor(cwd: string, base: string, head?: string): boolean {
  try {
    safeExec('git', ['merge-base', '--is-ancestor', base, head ?? 'HEAD'], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get shortstat between two refs. Returns parsed line counts.
 */
export function getShortstat(
  cwd: string,
  base: string,
  head?: string,
): { files: number; insertions: number; deletions: number } {
  try {
    const output = safeExec('git', ['diff', '--shortstat', base, head ?? 'HEAD'], { cwd });
    const files = parseInt(output.match(/(\d+) file/)?.[1] ?? '0', 10);
    const insertions = parseInt(output.match(/(\d+) insertion/)?.[1] ?? '0', 10);
    const deletions = parseInt(output.match(/(\d+) deletion/)?.[1] ?? '0', 10);
    return { files, insertions, deletions };
  } catch {
    return { files: 0, insertions: 0, deletions: 0 };
  }
}

/**
 * Get file statuses between two refs. Returns array of { status, file }.
 * Status is 'A' (added), 'M' (modified), 'D' (deleted), etc.
 */
export function getNameStatus(
  cwd: string,
  base: string,
  head?: string,
): Array<{ status: string; file: string }> {
  try {
    const output = safeExec('git', ['diff', '--name-status', base, head ?? 'HEAD'], { cwd });
    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status: status ?? '', file: rest.join('\t') };
      });
  } catch {
    return [];
  }
}

/**
 * Get the diff between two refs.
 */
export function getDiffBetween(cwd: string, base: string, head?: string): string {
  try {
    return safeExec('git', ['diff', base, head ?? 'HEAD'], { cwd, maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return '';
  }
}

// ─── Diff-for-review helper (CLI-only — uses log from ui.js) ─────

export interface DiffForReviewOptions {
  staged?: boolean;
}

export interface DiffForReviewConfig {
  ignorePatterns: string[];
  shieldIgnorePatterns?: string[];
}

export interface DiffForReviewResult {
  diff: string;
  changedFiles: string[];
}

/**
 * Shared diff-fetching logic used by both `shield` and `lint` commands.
 *
 * Merges ignore patterns, gets staged/all diff, filters by patterns,
 * falls back to branch diff, and extracts changed files.
 *
 * Returns `null` when no changes are detected.
 */
export async function getDiffForReview(
  options: DiffForReviewOptions,
  config: DiffForReviewConfig,
  cwd: string,
  tag: string,
): Promise<DiffForReviewResult | null> {
  const { log } = await import('./ui.js');
  const {
    extractChangedFiles,
    filterDiffByPatterns,
    getDefaultBranch,
    getGitBranchDiff,
    getGitDiff,
  } = await import('@mmnto/totem');

  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const mode = options.staged ? 'staged' : 'all';
  log.info(tag, `Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  let diff = filterDiffByPatterns(getGitDiff(mode, cwd), allIgnore);

  if (!diff.trim()) {
    const base = getDefaultBranch(cwd);
    log.dim(tag, `No relevant changes. Falling back to branch diff (${base}...HEAD)...`);
    diff = filterDiffByPatterns(getGitBranchDiff(cwd, base), allIgnore);
  }

  if (!diff.trim()) {
    log.warn(tag, 'No changes detected. Nothing to review.');
    return null;
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(tag, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  return { diff, changedFiles };
}
