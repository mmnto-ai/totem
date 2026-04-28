// Pure git utilities — delegated to core, re-exported for backward compatibility
export {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getGitBranch,
  getGitBranchDiff,
  getGitDiff,
  getGitDiffRange,
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

export type DiffForReviewSource = 'explicit-range' | 'staged' | 'uncommitted' | 'branch-vs-base';

export interface DiffForReviewOptions {
  staged?: boolean;
  /** Explicit ref range (mmnto-ai/totem#1717). When set, bypasses the implicit fallback chain. */
  diff?: string;
}

export interface DiffForReviewConfig {
  ignorePatterns: string[];
  shieldIgnorePatterns?: string[];
}

export interface DiffForReviewResult {
  diff: string;
  changedFiles: string[];
  /** Which path produced the diff (mmnto-ai/totem#1717 — surfaced for operator-visible logging). */
  source: DiffForReviewSource;
}

/**
 * Maximum diff size (in characters) before the prompt assembler truncates.
 * Mirrored from `shield-templates.MAX_DIFF_CHARS` so the resolution-layer
 * warning fires on the same threshold as the actual truncation site.
 *
 * Kept as a separate constant here rather than imported from
 * `commands/shield-templates.ts` to avoid a circular CLI dependency
 * (`git.ts` is intended to be substrate for many commands, not just review).
 */
export const REVIEW_DIFF_TRUNCATION_THRESHOLD = 50_000;

/**
 * Shared diff-fetching logic used by both `shield` and `lint` commands.
 *
 * Resolution order:
 *   1. `--diff <range>` (explicit, no fallback)
 *   2. `--staged` (staged-only) or working-tree (`all`) diff
 *   3. Branch-vs-base diff (`<default>...HEAD`) when 2 yields nothing
 *
 * The chosen resolution path is logged to stderr (mmnto-ai/totem#1717) so the operator's
 * mental model matches the actual git invocation. Diffs exceeding
 * `REVIEW_DIFF_TRUNCATION_THRESHOLD` chars surface a warning here, before
 * the LLM call is made, so the operator can re-run with a narrower
 * `--diff <range>` instead of paying for a degraded review.
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
    getGitDiffRange,
  } = await import('@mmnto/totem');

  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];

  let diff: string;
  let source: DiffForReviewSource;

  if (options.diff !== undefined) {
    // Explicit-range path — no fallback. getGitDiffRange rejects flag-injection
    // (leading `-`) and empty values; ignore patterns still apply per repo policy.
    log.info(tag, `Diff source: explicit range (${options.diff})`);
    diff = filterDiffByPatterns(getGitDiffRange(cwd, options.diff), allIgnore);
    source = 'explicit-range';
    if (!diff.trim()) {
      log.warn(tag, `Explicit range '${options.diff}' produced no diff. Nothing to review.`);
      return null;
    }
  } else {
    const mode: 'staged' | 'all' = options.staged ? 'staged' : 'all';
    const sourceLabel: DiffForReviewSource = options.staged ? 'staged' : 'uncommitted';
    log.info(tag, `Diff source: ${sourceLabel}`);
    diff = filterDiffByPatterns(getGitDiff(mode, cwd), allIgnore);
    source = sourceLabel;

    if (!diff.trim()) {
      const base = getDefaultBranch(cwd);
      log.info(tag, `Diff source: branch-vs-base (${base}...HEAD)`);
      diff = filterDiffByPatterns(getGitBranchDiff(cwd, base), allIgnore);
      source = 'branch-vs-base';
    }

    if (!diff.trim()) {
      log.warn(tag, 'No changes detected. Nothing to review.');
      return null;
    }
  }

  if (diff.length > REVIEW_DIFF_TRUNCATION_THRESHOLD) {
    log.warn(
      tag,
      `Diff exceeds ${REVIEW_DIFF_TRUNCATION_THRESHOLD} chars (${diff.length}). LLM review will see truncated content; re-run with a narrower --diff <range> to avoid degraded findings.`,
    );
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(tag, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  return { diff, changedFiles, source };
}
