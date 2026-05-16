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
    generateInputHash,
    generateOutputHash,
    readCompileManifest,
    safeExec,
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

  const actualInputHash = generateInputHash(lessonsDir);
  const actualOutputHash = generateOutputHash(rulesPath);

  const mismatches: string[] = [];

  if (actualInputHash !== manifest.input_hash) {
    mismatches.push(
      `Input hash mismatch — lessons changed since last compile.\n` +
        `  Expected: ${manifest.input_hash}\n` +
        `  Actual:   ${actualInputHash}`,
    );
  }

  if (actualOutputHash !== manifest.output_hash) {
    mismatches.push(
      `Output hash mismatch — compiled-rules.json was modified outside totem compile.\n` +
        `  Expected: ${manifest.output_hash}\n` +
        `  Actual:   ${actualOutputHash}`,
    );
  }

  if (mismatches.length > 0) {
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
  // existence of the template source at its monorepo-relative path.
  const monorepoTemplatePath = path.join(cwd, COMPILE_TEMPLATES_REL_PATH);
  const inMonorepo = fs.existsSync(monorepoTemplatePath);
  if (manifest.compile_worker_fingerprint !== undefined && inMonorepo) {
    const baseFingerprint = tryReadBaseFingerprint({
      cwd,
      manifestPath,
      safeExec,
      CompileManifestSchema,
      pathMod: path,
    });
    if (baseFingerprint !== undefined && baseFingerprint !== manifest.compile_worker_fingerprint) {
      const compileTemplatesChanged = branchDiffTouches({
        cwd,
        relPath: COMPILE_TEMPLATES_REL_PATH,
        safeExec,
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
            `  Base (origin/main): ${baseFingerprint}\n` +
            `  Current:            ${manifest.compile_worker_fingerprint}`,
          'Update packages/cli/src/commands/compile-templates.ts to make the worker change explicit, or pass --allow-compile-drift with a "## Compile Drift Justification" PR-body heading (or TOTEM_DRIFT_JUSTIFICATION env var when no PR exists yet).',
        );
      } else {
        verifyDriftJustification({ cwd, safeExec, TotemError });
        log.warn(
          TAG,
          `--allow-compile-drift accepted (${baseFingerprint.slice(0, 8)}… → ${manifest.compile_worker_fingerprint.slice(0, 8)}…). Justification recorded.`,
        );
      }
    }
  }

  const label = successColor(bold('PASS'));
  log.success(TAG, `${label} — Manifest verified: ${manifest.rule_count} rules, hashes match.`);
}

// ─── Auxiliary git + gh lookups (best-effort) ───────────

type SafeExec = typeof import('@mmnto/totem').safeExec;

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
}): string | undefined {
  const { cwd, manifestPath, safeExec, CompileManifestSchema, pathMod } = args;
  const relPath = pathMod.relative(cwd, manifestPath).replace(/\\/g, '/');
  // Try local main first, then origin/main — CI may only have origin/<branch>.
  for (const ref of ['main', 'origin/main']) {
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
function branchDiffTouches(args: { cwd: string; relPath: string; safeExec: SafeExec }): boolean {
  const { cwd, relPath, safeExec } = args;
  for (const ref of ['main', 'origin/main']) {
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
  TotemError: typeof import('@mmnto/totem').TotemError;
}): void {
  const { cwd, safeExec, TotemError } = args;
  const prBody = tryFetchCurrentBranchPrBody({ cwd, safeExec });
  if (prBody !== undefined) {
    if (!DRIFT_JUSTIFICATION_HEADING_RE.test(prBody)) {
      throw new TotemError(
        'COMPILE_FAILED',
        '--allow-compile-drift requires a `## Compile Drift Justification` heading in the PR body.',
        'Edit the PR body and add a `## Compile Drift Justification` section explaining the compile-worker change.',
      );
    }
    return;
  }

  // No PR body context — pre-push fortification.
  const justification = process.env['TOTEM_DRIFT_JUSTIFICATION'];
  if (justification === undefined || justification.trim().length === 0) {
    throw new TotemError(
      'COMPILE_FAILED',
      '--allow-compile-drift requires either an open PR (with a `## Compile Drift Justification` heading) or the TOTEM_DRIFT_JUSTIFICATION env var set non-empty.',
      'Open a PR with the heading, or set TOTEM_DRIFT_JUSTIFICATION="reason for the drift" in your shell and retry.',
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
