// ─── Constants ──────────────────────────────────────────

const TAG = 'VerifyLockfileSync';

// Single-lockfile assumption (pnpm-only per mmnto-ai/totem#1961 NOT-in-scope).
// Workspaces produce a single root lockfile by default; nested lockfiles in
// pnpm are rare and not covered by this gate.
const LOCKFILE_PATH = 'pnpm-lock.yaml';

const AUX_LOOKUP_TIMEOUT_MS = 10_000;

// Match dependency-pin additions in a unified diff. Anchors, left to right:
//   `^\+`         — line starts with a single `+`. Unified-diff file-header
//                   lines (`+++ b/path`) fail because the next char is `+`,
//                   not `\s` or `"`.
//   `\s*"`        — optional indent, then the opening quote of a JSON key.
//   `(?!version")` — negative lookahead rejects the package's own top-level
//                   `"version"` field, which appears in every Version
//                   Packages release commit without a lockfile diff yet
//                   correctly indicates the lockfile WAS regenerated (it
//                   appears separately in the diff and trips the fast-pass).
//                   The exclusion only matters when the lockfile happens to
//                   be absent for unrelated reasons.
//   `[^"]+"\s*:\s*"`
//                — the rest of the key plus the `: "` value-opener.
//   `[\^~]?\d+\.\d+`
//                — value starts with optional caret/tilde, then requires a
//                   major.minor digit pair. Rejects bare integer values like
//                   `"node": "20"` in the `engines` block (an over-tightening
//                   that costs one false-negative class on engine-only bumps,
//                   which generally don't require a lockfile diff anyway) and
//                   rejects `workspace:^` references (no leading digit).
const DEP_BUMP_RE = /^\+\s*"(?!version")[^"]+"\s*:\s*"[\^~]?\d+\.\d+/m;

// ─── Types ──────────────────────────────────────────────

export interface VerifyLockfileSyncResult {
  valid: boolean;
  /** Set only when valid === false; describes the failure and recovery action. */
  reason?: string;
}

// ─── Main command ───────────────────────────────────────

/**
 * Programmatic surface — returns the verification result without exiting or
 * throwing. The CLI action layer wraps this and throws a `TotemError` when
 * `result.valid === false` so the top-level `handleError` produces the exit
 * code (avoids direct `process.exit()` calls per AGENTS.md doctrine).
 *
 * Best-effort fall-through on git failures (matches verify-manifest's pattern
 * at packages/cli/src/commands/verify-manifest.ts:127-131): init-class
 * transient failures (no remote, detached HEAD, missing refs) skip the gate
 * rather than block pushes that are otherwise legitimate. Tenet 4's
 * fail-loud mandate has a documented carve-out for best-effort init-time
 * surfaces; the empty catches below carry `totem-context:` directives
 * locating that carve-out.
 */
export async function verifyLockfileSyncCommand(): Promise<VerifyLockfileSyncResult> {
  const { getDefaultBranch, resolveGitRoot, safeExec } = await import('@mmnto/totem');
  const { bold, log, success: successColor } = await import('../ui.js');

  const cwd = process.cwd();
  const repoRoot = resolveGitRoot(cwd);
  if (!repoRoot) {
    log.info(TAG, 'Not inside a git repo — skipping lockfile-sync verification.');
    return { valid: true };
  }

  // Precondition: the lockfile must be tracked. When gitignored or absent
  // from the index the gate does not apply (e.g., consumers using a
  // different package manager, or workspaces that explicitly exclude the
  // lockfile).
  let trackedLockfile = '';
  try {
    trackedLockfile = safeExec('git', ['ls-files', '--', LOCKFILE_PATH], {
      cwd: repoRoot,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
    });
    // totem-context: best-effort tracking probe — git failures here fall through to pass, matching verify-manifest's getDefaultBranch carve-out (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    return { valid: true };
  }
  if (trackedLockfile.length === 0) {
    log.info(TAG, `${LOCKFILE_PATH} is not tracked — skipping.`);
    return { valid: true };
  }

  // Resolve the default branch for the diff range. Best-effort: a degraded
  // git state (no remote, detached HEAD) falls through rather than blocking
  // pushes whose ref topology happens to defeat detection.
  let baseBranch: string;
  try {
    baseBranch = getDefaultBranch(repoRoot);
    // totem-context: best-effort default-branch lookup — git failures here fall through to pass, matching verify-manifest's getDefaultBranch carve-out (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    return { valid: true };
  }

  // Prefer origin/<base> over local <base> — local refs may be stale when
  // the user hasn't pulled recently, producing inconsistent gate behavior
  // between local and CI. Matches verify-manifest's `tryReadBaseFingerprint`
  // ref-order pattern.
  let changedFiles = '';
  let resolvedRef: string | null = null;
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      changedFiles = safeExec('git', ['diff', '--name-only', `${ref}...HEAD`], {
        cwd: repoRoot,
        timeout: AUX_LOOKUP_TIMEOUT_MS,
      });
      resolvedRef = ref;
      break;
      // totem-context: best-effort diff-range probe — try next ref candidate; fully exhausted both → fall through to pass (mmnto/totem#1440 Tenet 4 init-class)
    } catch {
      continue;
    }
  }
  if (resolvedRef === null) {
    log.info(TAG, 'Could not resolve diff range against default branch — skipping.');
    return { valid: true };
  }

  const files = changedFiles.split('\n').filter(Boolean);

  // Fast-pass: lockfile present in the diff range → the push includes the
  // expected lockfile companion to whatever package.json changes ride
  // alongside it. Most cohort-sync PRs and all Version Packages PRs land
  // here.
  if (files.includes(LOCKFILE_PATH)) {
    const label = successColor(bold('PASS'));
    log.success(TAG, `${label} — ${LOCKFILE_PATH} present in diff range.`);
    return { valid: true };
  }

  // Filter to package.json files in any directory (monorepo nested case).
  const pkgJsonPaths = files.filter((f) => f === 'package.json' || f.endsWith('/package.json'));
  if (pkgJsonPaths.length === 0) {
    return { valid: true };
  }

  // Pull the unified diff for the package.json files and scan for
  // dependency-pin additions. `safeExec`'s arg-array form handles quoting,
  // so multiple paths pass safely with no shell metacharacter risk.
  let unifiedDiff = '';
  try {
    unifiedDiff = safeExec('git', ['diff', `${resolvedRef}...HEAD`, '--', ...pkgJsonPaths], {
      cwd: repoRoot,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
    });
    // totem-context: best-effort unified-diff lookup — failure here means the gate cannot evaluate confidently, so fall through to pass rather than block (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    return { valid: true };
  }

  if (DEP_BUMP_RE.test(unifiedDiff)) {
    return {
      valid: false,
      reason:
        `Tracked lockfile detected, but ${LOCKFILE_PATH} is missing from the diff range while a package.json adds a dependency pin. ` +
        `Run \`pnpm install\` and stage ${LOCKFILE_PATH} before pushing.`,
    };
  }

  const label = successColor(bold('PASS'));
  log.success(TAG, `${label} — package.json diff present without dependency-pin additions.`);
  return { valid: true };
}

/**
 * CLI entry — wraps `verifyLockfileSyncCommand` and throws on failure so the
 * top-level `handleError` produces the non-zero exit code without a direct
 * `process.exit` call.
 */
export async function verifyLockfileSyncCliCommand(): Promise<void> {
  const { TotemError } = await import('@mmnto/totem');
  const { bold, errorColor, log } = await import('../ui.js');

  const result = await verifyLockfileSyncCommand();
  if (!result.valid) {
    log.error('Totem Error', result.reason!);
    const label = errorColor(bold('FAIL'));
    log.error('Totem Error', `${label} — Lockfile sync verification failed.`);
    throw new TotemError(
      'LOCKFILE_SYNC_FAILED',
      result.reason!,
      `Run \`pnpm install\` from the repo root to regenerate ${LOCKFILE_PATH}, then stage and commit it before re-pushing. CI runs with \`--frozen-lockfile\` and rejects pushes where a tracked package.json declares dependency pins that the lockfile does not reflect.`,
    );
  }
}
