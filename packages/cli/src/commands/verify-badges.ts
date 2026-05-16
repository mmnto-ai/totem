// ─── Constants ──────────────────────────────────────────

const TAG = 'VerifyBadges';

// ─── Types ──────────────────────────────────────────────

export interface VerifyBadgesOptions {
  /**
   * Injectable path-existence predicate used by `verifyToolClaims`. Production
   * callers omit this (falls back to `fs.existsSync`); tests pass a stub.
   */
  existsForTest?: (absolutePath: string) => boolean;
}

export interface VerifyBadgesResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Main command ───────────────────────────────────────

/**
 * Programmatic surface — returns the verification result without exiting or
 * throwing. The CLI action layer wraps this and throws a `TotemError` when
 * `result.valid === false` so the top-level `handleError` produces the exit
 * code (avoids direct `process.exit()` calls per AGENTS.md doctrine).
 */
export async function verifyBadgesCommand(
  options: VerifyBadgesOptions = {},
): Promise<VerifyBadgesResult> {
  const {
    DEFAULT_TOOL_INTEGRATIONS,
    extractBadgesFromDiff,
    getGitBranchDiff,
    resolveGitRoot,
    sanitizeForTerminal,
    verifySelfReferenceLinks,
    verifyToolClaims,
  } = await import('@mmnto/totem');
  const { bold, errorColor, log, success: successColor } = await import('../ui.js');

  const cwd = process.cwd();
  const repoRoot = resolveGitRoot(cwd);
  if (!repoRoot) {
    log.info(TAG, 'Not inside a git repo — skipping badge verification.');
    return { valid: true, errors: [], warnings: [] };
  }

  // getGitBranchDiff throws TotemGitError with a recovery hint if the base ref
  // is missing (e.g., fresh clone before `git fetch origin main`). Per Tenet 4
  // we let the error surface — silently marking pushes valid on git failure
  // would hide a real failure class, which the rule against fail-open catches
  // exists to prevent.
  const diff = getGitBranchDiff(repoRoot);

  const badges = extractBadgesFromDiff(diff);
  if (badges.length === 0) {
    log.info(TAG, 'No new shields.io badges in README.md — nothing to verify.');
    return { valid: true, errors: [], warnings: [] };
  }

  log.info(TAG, `Verifying ${badges.length} new badge(s) in README.md...`);

  const errors: string[] = [];
  errors.push(
    ...verifyToolClaims(badges, DEFAULT_TOOL_INTEGRATIONS, repoRoot, options.existsForTest),
  );
  errors.push(...verifySelfReferenceLinks(badges));

  const result: VerifyBadgesResult = {
    valid: errors.length === 0,
    errors,
    warnings: [],
  };

  if (!result.valid) {
    for (const msg of errors) {
      // Sanitize: error messages embed badge label/message/linkTarget pulled from
      // git diff content, which is untrusted. Prevents terminal-control-sequence
      // injection from a hostile README change.
      log.error('Totem Error', sanitizeForTerminal(msg));
    }
    const label = errorColor(bold('FAIL'));
    log.error('Totem Error', `${label} — Badge verification failed (${errors.length}).`);
  } else {
    const label = successColor(bold('PASS'));
    log.success(TAG, `${label} — ${badges.length} badge(s) verified.`);
  }

  return result;
}

/**
 * CLI entry — wraps `verifyBadgesCommand` and throws on failure so the
 * top-level `handleError` produces the non-zero exit code without a direct
 * `process.exit` call.
 */
export async function verifyBadgesCliCommand(): Promise<void> {
  const { TotemError } = await import('@mmnto/totem');
  const result = await verifyBadgesCommand({});
  if (!result.valid) {
    throw new TotemError(
      'BADGE_VERIFICATION_FAILED',
      `${result.errors.length} badge claim(s) failed verification.`,
      'Fix each claim above by adding the missing integration file(s) or pointing the badge at the canonical upstream URL. To bypass once for a known false positive: file a follow-up issue and use `git push --no-verify` (NOT recommended).',
    );
  }
}
