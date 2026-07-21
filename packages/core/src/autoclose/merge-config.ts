/**
 * Repo merge-config posture assertion for the auto-close enforcement seam
 * (mmnto-ai/totem#1762, E-lever addendum — strategy-claude 2026-07-21T0235Z; the
 * squash-only extension — codex supplement 2026-07-21T0356Z).
 *
 * The operator flipped all four governed repos to
 * `squash_merge_commit_title: PR_TITLE` + `squash_merge_commit_message: BLANK`
 * (executed 2026-07-21T02:30Z). BLANK stops GitHub composing a squash body from
 * COMMIT_MESSAGES, so the server-composed close-keyword channel is gone; PR_TITLE
 * makes the squash subject deterministically the PR title (a surface D1 already
 * scans pre-merge).
 *
 * D1 also asserts SQUASH-ONLY (`allow_squash_merge` on, `allow_merge_commit` and
 * `allow_rebase_merge` off). This is what LICENSES D2's single-HEAD, `(#N)`-subject
 * assumption: a rebase merge pushes several commits (an earlier close-keyword
 * commit would never be scanned when only the final SHA is read), and a regular
 * merge commit need not carry the squash-subject form (breaking receipt
 * correlation). Enabling squash-only is an OPERATOR settings action (routed
 * separately, like the E lever); until flipped, D1 reds loudly by design.
 *
 * A repo setting is one careless settings-page click from silently reverting — so
 * D1 ASSERTS the whole posture at workflow start and fails loud on drift (Tenet 4
 * parity-test rule applied to repo config; a "keep it set" intention is not a
 * coupling mechanism). Candidate standing row for the mmnto-ai/totem-strategy#482
 * parity manifest.
 *
 * Pure evaluator — thin `gh api repos/{owner}/{repo}` glue lives in the D1 script.
 */

/** The required squash-merge posture (the E lever). */
export const REQUIRED_SQUASH_MERGE_TITLE = 'PR_TITLE';
export const REQUIRED_SQUASH_MERGE_MESSAGE = 'BLANK';

/** The repo-config fields the posture assertion reads (from the repos API). */
export interface MergeConfigPosture {
  squash_merge_commit_title?: string;
  squash_merge_commit_message?: string;
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
}

/** Verdict of {@link evaluateMergeConfigPosture}. */
export interface MergeConfigVerdict {
  /** True iff every field matches the required posture. */
  conforms: boolean;
  /** Human-readable descriptions of each drifted field (empty when conforming). */
  drift: string[];
  /** Precise operator-facing message for the job log. */
  message: string;
}

/**
 * Evaluate whether a repo's merge config matches the required posture: the
 * E-lever squash-body shape (`PR_TITLE` + `BLANK`) AND squash-only (`allow_squash_
 * merge` on, merge-commit and rebase off). Returns the drift set (one entry per
 * off-posture field) and a precise message; the caller fails the check when
 * `!conforms`.
 */
export function evaluateMergeConfigPosture(config: MergeConfigPosture): MergeConfigVerdict {
  const drift: string[] = [];

  if (config.squash_merge_commit_title !== REQUIRED_SQUASH_MERGE_TITLE) {
    drift.push(
      `squash_merge_commit_title is "${config.squash_merge_commit_title ?? '(absent)'}", expected "${REQUIRED_SQUASH_MERGE_TITLE}"`,
    );
  }
  if (config.squash_merge_commit_message !== REQUIRED_SQUASH_MERGE_MESSAGE) {
    drift.push(
      `squash_merge_commit_message is "${config.squash_merge_commit_message ?? '(absent)'}", expected "${REQUIRED_SQUASH_MERGE_MESSAGE}"`,
    );
  }
  // Squash-only: squash on, merge-commit + rebase off (codex supplement — this
  // licenses D2's single-HEAD `(#N)`-subject assumption).
  if (config.allow_squash_merge !== true) {
    drift.push(`allow_squash_merge is ${fmt(config.allow_squash_merge)}, expected true`);
  }
  if (config.allow_merge_commit !== false) {
    drift.push(`allow_merge_commit is ${fmt(config.allow_merge_commit)}, expected false`);
  }
  if (config.allow_rebase_merge !== false) {
    drift.push(`allow_rebase_merge is ${fmt(config.allow_rebase_merge)}, expected false`);
  }

  const conforms = drift.length === 0;
  return {
    conforms,
    drift,
    message: conforms
      ? `Merge-config posture conforms: E lever (${REQUIRED_SQUASH_MERGE_TITLE} + ${REQUIRED_SQUASH_MERGE_MESSAGE}) + squash-only.`
      : `Merge-config posture DRIFTED from the required E-lever + squash-only posture: ` +
        `${drift.join('; ')}. Re-set it in repo Settings > General > Pull Requests before ` +
        'merging — a reverted posture re-opens the server-composed close-keyword channel or ' +
        'defeats D2 single-HEAD receipt correlation. mmnto-ai/totem#1762.',
  };
}

/** Render a possibly-absent boolean for the drift message. */
function fmt(value: boolean | undefined): string {
  return value === undefined ? '(absent)' : String(value);
}
