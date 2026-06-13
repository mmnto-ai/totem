// ─── Constants ──────────────────────────────────────────

const TAG = 'Verify';

// Path of the compile-worker prompt template relative to the monorepo root.
// Used in the branch-diff check to determine whether a fingerprint change is
// "justified" (the user explicitly edited the prompts) or "unjustified" (the
// fingerprint moved without a corresponding source change).
const COMPILE_TEMPLATES_REL_PATH = 'packages/cli/src/commands/compile-templates.ts';

// Heading the PR body must contain when `--allow-compile-drift` is used in CI.
// The heading itself is the accountability surface; the body underneath is the
// reviewer-readable justification.
const DRIFT_JUSTIFICATION_HEADING_RE = /^## Compile Drift Justification\b/m;

// Best-effort timeouts for the auxiliary git/gh lookups. The drift check
// should never block verify-manifest indefinitely if origin/main or `gh` is
// unreachable.
const AUX_LOOKUP_TIMEOUT_MS = 10_000;
const AUX_LOOKUP_MAX_BUFFER = 5 * 1024 * 1024;

// ─── Public types ───────────────────────────────────────

export interface VerifyManifestOptions {
  /**
   * Override compile-worker fingerprint drift. In CI, the PR body must contain
   * a `## Compile Drift Justification` heading. Pre-push (no open PR) requires
   * the `TOTEM_DRIFT_JUSTIFICATION` env var to be set non-empty — articulation
   * without validation, per Proposal 278 § Q3.
   */
  allowCompileDrift?: boolean;
}

// ─── Main command ───────────────────────────────────────

export async function verifyManifestCommand(opts?: VerifyManifestOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    CompileManifestSchema,
    findRepoRootSync,
    generateInputHash,
    generateOutputHash,
    getDefaultBranch,
    readCompileManifest,
    safeExec,
    TotemConfigError,
    TotemError,
  } = await import('@mmnto/totem');
  const { bold, errorColor, log, success: successColor } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const allowCompileDrift = opts?.allowCompileDrift ?? false;
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const manifestPath = path.join(cwd, config.totemDir, 'compile-manifest.json');
  const rulesPath = path.join(cwd, config.totemDir, 'compiled-rules.json');
  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');

  log.info(TAG, 'Verifying compile manifest integrity...');

  // readCompileManifest throws TotemParseError if missing or invalid
  const manifest = readCompileManifest(manifestPath);

  // Pass cwd so the input hash covers git-tracked lessons only — an untracked
  // MCP scratch lesson must not trip this gate on an unrelated push
  // (mmnto-ai/totem#2051 / mmnto-ai/totem#2055). Falls back to all-files when
  // run outside a git repo.
  const actualInputHash = generateInputHash(lessonsDir, cwd);
  const actualOutputHash = generateOutputHash(rulesPath);

  const inputMismatch = actualInputHash !== manifest.input_hash;
  const outputMismatch = actualOutputHash !== manifest.output_hash;

  const mismatches: string[] = [];

  if (inputMismatch) {
    mismatches.push(
      `Input hash mismatch — lessons changed since last compile.\n` +
        `  Expected: ${manifest.input_hash}\n` +
        `  Actual:   ${actualInputHash}`,
    );
  }

  if (outputMismatch) {
    mismatches.push(
      `Output hash mismatch — compiled-rules.json was modified outside totem compile.\n` +
        `  Expected: ${manifest.output_hash}\n` +
        `  Actual:   ${actualOutputHash}`,
    );
  }

  let freezeDowngraded = false;
  if (mismatches.length > 0) {
    // Freeze consult (mmnto-ai/totem#2137, strategy#584 sub-task 4 — the 0014Z ruled shape).
    // Sensing above is unchanged (Tenet 13): hashes report disk truth; the
    // freeze only moves the VERDICT for the lesson-only case. The consult runs
    // whenever drift is sensed so channel warnings surface even on blocking
    // paths (a corrupt distributed snapshot warns AND fails).
    const freezeMatch = await consultRuleCompilationFreeze({
      cwd,
      totemDir: path.join(cwd, config.totemDir),
      warn: (msg) => log.warn(TAG, msg),
    });

    if (inputMismatch && !outputMismatch && freezeMatch !== undefined) {
      // Lesson-only staleness + active rule-compilation freeze (any
      // provenance) ⟹ WARN, exit 0: push proceeds, zero compile invocation,
      // zero artifact churn. Output-hash drift never takes this path —
      // the regenerable cache stays protected (Tenet 20).
      const { DOCTRINE_PIN_PACKAGE } = await import('./init-doctrine.js');
      const source =
        freezeMatch.provenance === 'cohort'
          ? `cohort freeze via ${DOCTRINE_PIN_PACKAGE}@${freezeMatch.sourceVersion ?? '?'}`
          : 'local freeze';
      log.warn(TAG, 'Input hash mismatch — lessons changed since last compile.');
      log.warn(
        TAG,
        `Lesson-only staleness downgraded to WARN: "${freezeMatch.entry.subsystem}" is frozen (${source}) — push proceeds with NO compile invocation while the freeze stands.`,
      );
      if (freezeMatch.entry.tracking)
        log.warn(TAG, `Freeze tracking: ${freezeMatch.entry.tracking}`);
      log.warn(
        TAG,
        'Accrued lesson staleness blocks again at unfreeze; a real compile settles it then.',
      );
      freezeDowngraded = true;
    } else {
      for (const msg of mismatches) {
        log.error('Totem Error', msg);
      }
      const label = errorColor(bold('FAIL'));
      log.error('Totem Error', `${label} — Manifest verification failed.`);
      throw new TotemError(
        'COMPILE_FAILED',
        'Compile manifest verification failed.',
        'Run "totem compile" to regenerate the manifest.',
      );
    }
  }

  // ─── Fingerprint drift check (Proposal 278 § Action 3) ───
  //
  // The fingerprint is a producer attestation (model + sampling params +
  // prompt-template content hash). When the local fingerprint differs from
  // origin/main's AND the prompt-template source did not change in this
  // branch, that's a signal something else moved — model alias rebrand,
  // local-only template edit, or an unintended worker config swap.
  //
  // Scope-limited to the mmnto-ai/totem monorepo: external @mmnto/cli
  // consumers don't own packages/cli/src/commands/compile-templates.ts, so
  // a CLI version bump would always trip an unjustified-drift fail for them.
  // Phase 1 scope per Proposal 278 is internal compile-worker surveillance —
  // the fingerprint is still recorded in their manifest for observability,
  // but the fail-loud gate only fires inside the monorepo. Detected via
  // existence of the template source at its monorepo-relative path. Walk up
  // from cwd so the check survives running from a sub-directory of the
  // monorepo (e.g., `cd packages/cli && pnpm totem verify-manifest`).
  const inMonorepo = findMonorepoTemplate(cwd, path, fs) !== undefined;
  if (manifest.compile_worker_fingerprint !== undefined && inMonorepo) {
    // Resolve the base branch dynamically — repos can use main, master, or
    // something custom (e.g., `develop`). `getDefaultBranch` reads
    // origin/HEAD with fallback to main/master. The base-ref/diff lookups
    // below are themselves best-effort, so a wrong guess just no-ops the
    // drift check rather than throwing.
    let baseBranch = 'main';
    try {
      baseBranch = getDefaultBranch(cwd);
      // totem-context: getDefaultBranch fall-through is best-effort; baseBranch keeps the 'main' initializer when git is unavailable or no remote is configured
    } catch (err) {
      void err;
    }
    const baseFingerprint = tryReadBaseFingerprint({
      cwd,
      manifestPath,
      safeExec,
      CompileManifestSchema,
      pathMod: path,
      findRepoRootSync,
      baseBranch,
    });
    if (baseFingerprint !== undefined && baseFingerprint !== manifest.compile_worker_fingerprint) {
      const compileTemplatesChanged = branchDiffTouches({
        cwd,
        relPath: COMPILE_TEMPLATES_REL_PATH,
        safeExec,
        baseBranch,
      });
      if (compileTemplatesChanged) {
        log.info(
          TAG,
          `Fingerprint changed (${baseFingerprint.slice(0, 8)}… → ${manifest.compile_worker_fingerprint.slice(0, 8)}…) — accompanied by compile-templates.ts edit; accepted.`,
        );
      } else if (!allowCompileDrift) {
        throw new TotemError(
          'COMPILE_FAILED',
          `Compile-worker fingerprint drift detected without a packages/cli/src/commands/compile-templates.ts change.\n` +
            `  Base (origin/${baseBranch}): ${baseFingerprint}\n` +
            `  Current:            ${manifest.compile_worker_fingerprint}`,
          'Update packages/cli/src/commands/compile-templates.ts to make the worker change explicit, or pass --allow-compile-drift with a "## Compile Drift Justification" PR-body heading (or TOTEM_DRIFT_JUSTIFICATION env var when no PR exists yet).',
        );
      } else {
        verifyDriftJustification({ cwd, safeExec, TotemConfigError });
        log.warn(
          TAG,
          `--allow-compile-drift accepted (${baseFingerprint.slice(0, 8)}… → ${manifest.compile_worker_fingerprint.slice(0, 8)}…). Justification recorded.`,
        );
      }
    }
  }

  const label = successColor(bold('PASS'));
  if (freezeDowngraded) {
    log.success(
      TAG,
      `${label} — Manifest accepted under freeze: lesson staleness warned (not blocked); ${manifest.rule_count} rules, output hash matches.`,
    );
  } else {
    log.success(TAG, `${label} — Manifest verified: ${manifest.rule_count} rules, hashes match.`);
  }
}

/**
 * Effective-freeze consult for the staleness verdict (mmnto-ai/totem#2137). Returns the
 * active entry whose `id` is the shared `RULE_COMPILATION_FREEZE_ID` constant
 * (imported from core — never a duplicate literal), at ANY provenance: a
 * repo that deliberately froze its own compile path gets the same
 * no-invocation behavior as the cohort hold (mmnto-ai/totem#2167 round, Q3 ruling).
 *
 * ANY consult failure — including a corrupt LOCAL freeze.json, which the
 * core reader throws on fail-closed — degrades to `undefined`
 * (no-freeze-visible) with a loud warning: the conservative direction, since
 * the staleness gate then stays blocking. This consult can weaken a block
 * into a warn, so its own failure must never do so.
 */
async function consultRuleCompilationFreeze(args: {
  cwd: string;
  totemDir: string;
  warn: (msg: string) => void;
}): Promise<import('@mmnto/totem').ActiveFreeze | undefined> {
  try {
    const { readEffectiveFreezes, RULE_COMPILATION_FREEZE_ID } = await import('@mmnto/totem');
    const { DOCTRINE_PIN_PACKAGE } = await import('./init-doctrine.js');
    const result = readEffectiveFreezes(args.cwd, args.totemDir, DOCTRINE_PIN_PACKAGE);
    for (const w of result.warnings) args.warn(w);
    return result.entries.find((f) => f.entry.id === RULE_COMPILATION_FREEZE_ID);
    // totem-context: consult failure degrades to no-freeze-visible — the staleness gate stays blocking (conservative); never a silent pass
  } catch (err) {
    args.warn(
      `Freeze consult failed (${err instanceof Error ? err.message : String(err)}) — proceeding as no-freeze-visible; the staleness gate stays blocking.`,
    );
    return undefined;
  }
}

// ─── Auxiliary git + gh lookups (best-effort) ───────────

type SafeExec = typeof import('@mmnto/totem').safeExec;

/**
 * Walk upward from `start` looking for `COMPILE_TEMPLATES_REL_PATH`. Returns
 * the absolute path when found, undefined when the search reaches the
 * filesystem root without a match. Allows `verify-manifest` to detect that
 * it's running inside the totem monorepo regardless of which sub-directory
 * the caller invoked it from.
 */
function findMonorepoTemplate(
  start: string,
  pathMod: typeof import('node:path'),
  fsMod: typeof import('node:fs'),
): string | undefined {
  let current = pathMod.resolve(start);
  while (true) {
    const candidate = pathMod.join(current, COMPILE_TEMPLATES_REL_PATH);
    if (fsMod.existsSync(candidate)) return candidate;
    const parent = pathMod.dirname(current);
    if (parent === current) return undefined; // hit filesystem root
    current = parent;
  }
}

/**
 * Read the `compile_worker_fingerprint` field from origin/main's compile
 * manifest. Best-effort: returns undefined when origin/main is unreachable,
 * the manifest doesn't exist on origin/main, or parsing fails. Callers must
 * treat undefined as "no comparison available" rather than "no drift".
 */
function tryReadBaseFingerprint(args: {
  cwd: string;
  manifestPath: string;
  safeExec: SafeExec;
  CompileManifestSchema: typeof import('@mmnto/totem').CompileManifestSchema;
  pathMod: typeof import('node:path');
  findRepoRootSync: typeof import('@mmnto/totem').findRepoRootSync;
  baseBranch: string;
}): string | undefined {
  const {
    cwd,
    manifestPath,
    safeExec,
    CompileManifestSchema,
    pathMod,
    findRepoRootSync,
    baseBranch,
  } = args;
  // `git show <ref>:<path>` expects `<path>` relative to the repo root, not
  // the current working directory. When verify-manifest runs from a sub-dir
  // of the repo, `path.relative(cwd, manifestPath)` would produce a path
  // that git rejects. `findRepoRootSync` walks up looking for `.git/` — the
  // JS-side variant of `resolveGitRoot` that's portable on Windows where
  // `git rev-parse --show-toplevel` may emit a path differing from cwd in
  // case / 8.3 short-name resolution. See packages/core/src/sys/git.ts.
  const pathBase = findRepoRootSync(cwd) ?? cwd;
  const relPath = pathMod.relative(pathBase, manifestPath).replace(/\\/g, '/');
  // Prefer origin/<base> as the canonical source — the local copy may be
  // stale when the user hasn't pulled in a while. CI environments may only
  // have origin/<branch> at all; local dev usually has both, and an
  // out-of-date local copy would produce false-positive or false-negative
  // drift signals.
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      const raw = safeExec('git', ['show', `${ref}:${relPath}`], {
        cwd,
        timeout: AUX_LOOKUP_TIMEOUT_MS,
        maxBuffer: AUX_LOOKUP_MAX_BUFFER,
      });
      const parsed = CompileManifestSchema.parse(JSON.parse(raw));
      return parsed.compile_worker_fingerprint;
      // totem-context: best-effort base-ref lookup; missing/unparseable ref → fall through to undefined and skip the drift comparison
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * True when `relPath` appears in the file list of the branch-vs-main diff.
 * Best-effort: returns false when the branch diff cannot be computed
 * (uncommitted local-only branch, detached HEAD, etc.). Conservative default
 * — a missing diff treats the drift as unjustified, forcing the user to
 * either commit the template change or use the override flag.
 */
function branchDiffTouches(args: {
  cwd: string;
  relPath: string;
  safeExec: SafeExec;
  baseBranch: string;
}): boolean {
  const { cwd, relPath, safeExec, baseBranch } = args;
  // Prefer origin/<base> to match `tryReadBaseFingerprint`'s ref order;
  // stale local refs would produce inconsistent drift signals between the
  // base-fingerprint read and the template-change detection.
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      const raw = safeExec('git', ['diff', '--name-only', `${ref}...HEAD`], {
        cwd,
        timeout: AUX_LOOKUP_TIMEOUT_MS,
        maxBuffer: AUX_LOOKUP_MAX_BUFFER,
      });
      const files = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      return files.includes(relPath);
      // totem-context: best-effort branch-diff lookup; missing diff → conservative false (forces explicit template commit or override)
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Resolve a justification for the `--allow-compile-drift` override.
 *
 *   1. If an open PR for the current branch is discoverable via `gh pr view`,
 *      require a `## Compile Drift Justification` heading in the PR body.
 *   2. Otherwise (no PR open, `gh` unavailable, etc.), require the
 *      `TOTEM_DRIFT_JUSTIFICATION` env var to be set non-empty. The contents
 *      are not validated — the act of typing the justification is the
 *      forcing function. Per Proposal 278 § Q3 (env-var fortification).
 *
 * CI re-runs `verify-manifest` against the PR-body context at merge time, so
 * the heading is the binding accountability surface even when the local
 * override path took the env-var route.
 */
function verifyDriftJustification(args: {
  cwd: string;
  safeExec: SafeExec;
  TotemConfigError: typeof import('@mmnto/totem').TotemConfigError;
}): void {
  const { cwd, safeExec, TotemConfigError } = args;
  const prBody = tryFetchCurrentBranchPrBody({ cwd, safeExec });
  if (prBody !== undefined) {
    if (!DRIFT_JUSTIFICATION_HEADING_RE.test(prBody)) {
      // Flag misuse — TotemConfigError is the canonical CLI-layer
      // flag-validation class per .gemini/styleguide.md § 76. CONFIG_INVALID
      // because the flag was passed but the conditions for using it weren't
      // met (heading missing).
      throw new TotemConfigError(
        '--allow-compile-drift requires a `## Compile Drift Justification` heading in the PR body.',
        'Edit the PR body and add a `## Compile Drift Justification` section explaining the compile-worker change.',
        'CONFIG_INVALID',
      );
    }
    return;
  }

  // No PR body context — pre-push fortification.
  const justification = process.env['TOTEM_DRIFT_JUSTIFICATION'];
  if (justification === undefined || justification.trim().length === 0) {
    throw new TotemConfigError(
      '--allow-compile-drift requires either an open PR (with a `## Compile Drift Justification` heading) or the TOTEM_DRIFT_JUSTIFICATION env var set non-empty.',
      'Open a PR with the heading, or set TOTEM_DRIFT_JUSTIFICATION="reason for the drift" in your shell and retry.',
      'CONFIG_INVALID',
    );
  }
}

/**
 * Fetch the body of the open PR associated with the current branch via
 * `gh pr view --json body`. Returns undefined when no PR exists, `gh` is
 * unavailable, or the call fails for any other reason. Callers treat
 * undefined as "no PR context" rather than "empty PR body".
 */
function tryFetchCurrentBranchPrBody(args: {
  cwd: string;
  safeExec: SafeExec;
}): string | undefined {
  const { cwd, safeExec } = args;
  try {
    const raw = safeExec('gh', ['pr', 'view', '--json', 'body'], {
      cwd,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
      maxBuffer: AUX_LOOKUP_MAX_BUFFER,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    const parsed = JSON.parse(raw) as { body?: unknown };
    if (typeof parsed.body !== 'string') return undefined;
    return parsed.body;
    // totem-context: best-effort PR body lookup; gh unavailable / no open PR → fall through to TOTEM_DRIFT_JUSTIFICATION env var gate
  } catch {
    return undefined;
  }
}
