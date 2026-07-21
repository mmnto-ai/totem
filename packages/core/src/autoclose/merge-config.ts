/**
 * Repo merge-config posture assertion for the auto-close enforcement seam
 * (mmnto-ai/totem#1762, E-lever addendum — strategy-claude 2026-07-21T0235Z).
 *
 * The operator flipped all four governed repos to
 * `squash_merge_commit_title: PR_TITLE` + `squash_merge_commit_message: BLANK`
 * (executed 2026-07-21T02:30Z). BLANK stops GitHub composing a squash body from
 * COMMIT_MESSAGES, so the server-composed close-keyword channel is gone; PR_TITLE
 * makes the squash subject deterministically the PR title (a surface D1 already
 * scans pre-merge). But a repo setting is one careless settings-page click from
 * silently reverting — so D1 ASSERTS the posture at workflow start and fails loud
 * on drift (Tenet 4 parity-test rule applied to repo config; a "keep it set"
 * intention is not a coupling mechanism). Candidate standing row for the
 * mmnto-ai/totem-strategy#482 parity manifest.
 *
 * Pure evaluator — thin `gh api repos/{owner}/{repo}` glue lives in the D1 script.
 */

/** The required squash-merge posture (the E lever). */
export const REQUIRED_SQUASH_MERGE_TITLE = 'PR_TITLE';
export const REQUIRED_SQUASH_MERGE_MESSAGE = 'BLANK';

/** The two repo-config fields the posture assertion reads. */
export interface MergeConfigPosture {
  squash_merge_commit_title?: string;
  squash_merge_commit_message?: string;
}

/** Verdict of {@link evaluateMergeConfigPosture}. */
export interface MergeConfigVerdict {
  /** True iff both fields match the E-lever posture. */
  conforms: boolean;
  /** Human-readable descriptions of each drifted field (empty when conforming). */
  drift: string[];
  /** Precise operator-facing message for the job log. */
  message: string;
}

/**
 * Evaluate whether a repo's squash-merge config matches the E-lever posture
 * (`PR_TITLE` + `BLANK`). Returns the drift set (one entry per off-posture field)
 * and a precise message; the caller fails the check when `!conforms`.
 */
export function evaluateMergeConfigPosture(config: MergeConfigPosture): MergeConfigVerdict {
  const drift: string[] = [];
  const title = config.squash_merge_commit_title;
  const message = config.squash_merge_commit_message;

  if (title !== REQUIRED_SQUASH_MERGE_TITLE) {
    drift.push(
      `squash_merge_commit_title is "${title ?? '(absent)'}", expected "${REQUIRED_SQUASH_MERGE_TITLE}"`,
    );
  }
  if (message !== REQUIRED_SQUASH_MERGE_MESSAGE) {
    drift.push(
      `squash_merge_commit_message is "${message ?? '(absent)'}", expected "${REQUIRED_SQUASH_MERGE_MESSAGE}"`,
    );
  }

  const conforms = drift.length === 0;
  return {
    conforms,
    drift,
    message: conforms
      ? `Merge-config posture conforms to the E lever (${REQUIRED_SQUASH_MERGE_TITLE} + ${REQUIRED_SQUASH_MERGE_MESSAGE}).`
      : `Merge-config posture DRIFTED from the E lever (${REQUIRED_SQUASH_MERGE_TITLE} + ` +
        `${REQUIRED_SQUASH_MERGE_MESSAGE}): ${drift.join('; ')}. Re-set it in repo Settings > ` +
        'General > Pull Requests before merging — a reverted posture re-opens the ' +
        'server-composed close-keyword channel. mmnto-ai/totem#1762.',
  };
}
