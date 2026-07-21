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
 * Pure evaluator — thin GraphQL glue lives in the D1 script. The source is
 * GraphQL (`squashMergeAllowed` / `mergeCommitAllowed` / `rebaseMergeAllowed` /
 * `squashMergeCommitTitle` / `squashMergeCommitMessage`), NOT the REST repos
 * endpoint: REST omits the merge-policy fields for callers without admin
 * visibility, and the Actions `GITHUB_TOKEN` is such a caller — discovered on
 * D1's first live run, where a healthy posture read as all-absent. That failure
 * class gets its own verdict (`unverifiable`) so a token-visibility problem is
 * never misreported as settings drift.
 */

/** The required squash-merge posture (the E lever). */
export const REQUIRED_SQUASH_MERGE_TITLE = 'PR_TITLE';
export const REQUIRED_SQUASH_MERGE_MESSAGE = 'BLANK';

/** The repo-config fields the posture assertion reads (absent/null = not visible). */
export interface MergeConfigPosture {
  squash_merge_commit_title?: string | null;
  squash_merge_commit_message?: string | null;
  allow_squash_merge?: boolean | null;
  allow_merge_commit?: boolean | null;
  allow_rebase_merge?: boolean | null;
}

/**
 * Verdict class: `drift` = a field is PRESENT and wrong (settings action needed);
 * `unverifiable` = no field is wrong but at least one is absent from the config
 * source (token-visibility failure — do NOT touch settings on this verdict).
 */
export type MergeConfigStatus = 'conforms' | 'drift' | 'unverifiable';

/** Verdict of {@link evaluateMergeConfigPosture}. */
export interface MergeConfigVerdict {
  /** True iff every field is present AND matches the required posture. */
  conforms: boolean;
  status: MergeConfigStatus;
  /** Human-readable descriptions of each present-and-wrong field. */
  drift: string[];
  /** Field names the config source did not carry (token-visibility class). */
  absent: string[];
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
  const absent: string[] = [];

  const check = (
    name: string,
    value: string | boolean | null | undefined,
    required: string | boolean,
  ): void => {
    if (value === null || value === undefined) {
      absent.push(name);
    } else if (value !== required) {
      drift.push(
        `${name} is ${typeof value === 'string' ? `"${value}"` : String(value)}, expected ${typeof required === 'string' ? `"${required}"` : String(required)}`,
      );
    }
  };

  check('squash_merge_commit_title', config.squash_merge_commit_title, REQUIRED_SQUASH_MERGE_TITLE);
  check(
    'squash_merge_commit_message',
    config.squash_merge_commit_message,
    REQUIRED_SQUASH_MERGE_MESSAGE,
  );
  // Squash-only: squash on, merge-commit + rebase off (codex supplement — this
  // licenses D2's single-HEAD `(#N)`-subject assumption).
  check('allow_squash_merge', config.allow_squash_merge, true);
  check('allow_merge_commit', config.allow_merge_commit, false);
  check('allow_rebase_merge', config.allow_rebase_merge, false);

  const status: MergeConfigStatus =
    drift.length > 0 ? 'drift' : absent.length > 0 ? 'unverifiable' : 'conforms';
  const message =
    status === 'conforms'
      ? `Merge-config posture conforms: E lever (${REQUIRED_SQUASH_MERGE_TITLE} + ${REQUIRED_SQUASH_MERGE_MESSAGE}) + squash-only.`
      : status === 'drift'
        ? `Merge-config posture DRIFTED from the required E-lever + squash-only posture: ` +
          `${drift.join('; ')}${absent.length > 0 ? ` (also not visible to this token: ${absent.join(', ')})` : ''}. ` +
          'Re-set it in repo Settings > General > Pull Requests before ' +
          'merging — a reverted posture re-opens the server-composed close-keyword channel or ' +
          'defeats D2 single-HEAD receipt correlation. mmnto-ai/totem#1762.'
        : `Merge-config posture UNVERIFIABLE — the config source did not carry: ${absent.join(', ')}. ` +
          'This is a token-visibility failure, NOT settings drift — do not touch repo settings on this ' +
          'message. The REST repos endpoint omits merge-policy fields for non-admin callers (the Actions ' +
          'GITHUB_TOKEN is one); the D1 glue must read the posture via GraphQL (squashMergeAllowed / ' +
          'mergeCommitAllowed / rebaseMergeAllowed / squashMergeCommitTitle / squashMergeCommitMessage), ' +
          'which a plain read token can see. mmnto-ai/totem#1762.';

  return { conforms: status === 'conforms', status, drift, absent, message };
}
