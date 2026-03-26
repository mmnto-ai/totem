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
