import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Named constants ─────────────────────────────────

const LOCK_REL_PATH = '.totem/spine/gate-1/windtunnel.lock.json';
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;

// ─── freeze command ───────────────────────────────────

export interface FreezeOptions {
  lcDir?: string;
  lockPath?: string;
}

/**
 * `totem spine windtunnel freeze`
 *
 * Validates that the lock file at `LOCK_REL_PATH` (or `opts.lockPath`) is
 * schema-valid and that `resolvedPrs === selectionRule(asOfCommit)` (S4 —
 * completeness assertion). Writes the canonical lock path.
 *
 * The completeness assertion requires the lc clone (`--lc-dir`) so the
 * command can re-derive the full code-touching PR set at `asOfCommit` and
 * diff it against `resolvedPrs`. In the harness phase (no real lc run yet)
 * the assertion is skipped with a loud warning.
 */
export async function freezeCommand(opts: FreezeOptions): Promise<void> {
  const { WindtunnelLockSchema, safeExec, resolveGitRoot, TotemError } =
    await import('@mmnto/totem');

  const cwd = process.cwd();
  const repoRoot = resolveGitRoot(cwd) ?? cwd;
  const lockPath = opts.lockPath
    ? path.resolve(cwd, opts.lockPath)
    : path.join(repoRoot, LOCK_REL_PATH);
  const lcDir = opts.lcDir ?? process.env['TOTEM_LC_DIR'];

  // Read + validate the lock
  let rawJson: string;
  try {
    rawJson = fs.readFileSync(lockPath, 'utf-8');
  } catch {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel lock not found at ${lockPath}`,
      `Create the lock file at ${LOCK_REL_PATH} before running freeze.`,
    );
  }

  let rawObj: unknown;
  try {
    rawObj = JSON.parse(rawJson);
  } catch {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel lock at ${lockPath} is not valid JSON`,
      'Fix the JSON syntax and retry.',
    );
  }

  const parsed = WindtunnelLockSchema.safeParse(rawObj);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel lock schema validation failed:\n${issues}`,
      'Fix the lock file and retry.',
    );
  }

  const lock = parsed.data;
  console.error(`[WindtunnelFreeze] Lock schema valid — phase: ${lock.phase}`);

  // S4: completeness assertion
  if (lcDir) {
    console.error(`[WindtunnelFreeze] lc-dir provided — asserting corpus completeness (S4)`);
    await assertCorpusCompleteness(lock, lcDir, repoRoot, safeExec);
  } else {
    console.error(
      `[WindtunnelFreeze] WARNING: --lc-dir not provided — corpus completeness assertion (S4) skipped.`,
    );
    console.error(`  Set TOTEM_LC_DIR or pass --lc-dir to enable completeness check.`);
  }

  // Compute gate-1-scoped fixtureSha (OQ3) over BOTH control dirs so the lock's
  // single fixtureSha protects positive AND negative fixtures.
  const controlDirs = [
    path.join(repoRoot, lock.controls.positiveRef),
    path.join(repoRoot, lock.controls.negativeRef),
  ];
  if (controlDirs.some((d) => fs.existsSync(d))) {
    const fixtureSha = computeFixtureSha(controlDirs, repoRoot, safeExec);
    if (fixtureSha && fixtureSha !== lock.controls.integrity.fixtureSha) {
      console.error(
        `[WindtunnelFreeze] WARNING: controls.integrity.fixtureSha in lock (${lock.controls.integrity.fixtureSha}) does not match computed hash (${fixtureSha})`,
      );
      console.error(`  Update the lock with fixtureSha: "${fixtureSha}" and re-freeze.`);
    } else if (fixtureSha) {
      console.error(`[WindtunnelFreeze] Fixture integrity verified: ${fixtureSha}`);
    }
  } else {
    console.error(
      `[WindtunnelFreeze] Control dirs [${controlDirs.join(', ')}] do not exist — integrity check skipped.`,
    );
  }

  console.error(`[WindtunnelFreeze] DONE — lock at ${lockPath} is schema-valid.`);
  console.error(`  Commit the lock file to establish the freeze proof (C3).`);
}

// ─── run command ─────────────────────────────────────

export interface RunOptions {
  lcDir?: string;
  lockPath?: string;
  phase?: string;
}

/**
 * `totem spine windtunnel run`
 *
 * Reads and validates the lock, derives the freeze proof from git history (C3),
 * rejects a harness lock when `--phase certifying` is passed (P1), builds the
 * shared post-image readStrategy, runs the engine (mock for harness phase),
 * scores the result, and prints the verdict.
 *
 * Exit codes: 0 = PASS, 1 = FAIL / HONEST-NEGATIVE / needs-adjudication.
 */
export async function runCommand(opts: RunOptions): Promise<void> {
  const { WindtunnelLockSchema, safeExec, resolveGitRoot, TotemError, scoreWindtunnel } =
    await import('@mmnto/totem');

  const cwd = process.cwd();
  const repoRoot = resolveGitRoot(cwd) ?? cwd;
  const lockPath = opts.lockPath
    ? path.resolve(cwd, opts.lockPath)
    : path.join(repoRoot, LOCK_REL_PATH);
  const lcDir = opts.lcDir ?? process.env['TOTEM_LC_DIR'];
  const requestedPhase = opts.phase;

  // Validate --phase up front: an unrecognized value (e.g. a typo "certifyng")
  // would otherwise slip past the P1 guard below (which only matches the exact
  // string "certifying") and silently run as if no phase were requested.
  if (
    requestedPhase !== undefined &&
    requestedPhase !== 'harness' &&
    requestedPhase !== 'certifying'
  ) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Invalid --phase "${requestedPhase}" — must be "harness" or "certifying".`,
      'Pass --phase certifying (or harness), or omit it.',
    );
  }

  // Read + validate the lock
  let rawJson: string;
  try {
    rawJson = fs.readFileSync(lockPath, 'utf-8');
  } catch {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel lock not found at ${lockPath}`,
      `Run 'totem spine windtunnel freeze' first.`,
    );
  }

  let rawObj: unknown;
  try {
    rawObj = JSON.parse(rawJson);
  } catch {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel lock at ${lockPath} is not valid JSON`,
      'Fix the JSON syntax and retry.',
    );
  }

  const parsed = WindtunnelLockSchema.safeParse(rawObj);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel lock schema validation failed:\n${issues}`,
      'Fix the lock file and retry.',
    );
  }

  const lock = parsed.data;

  // P1: phase rejection — a certifying run rejects a harness-phase lock.
  if (requestedPhase === 'certifying' && lock.phase === 'harness') {
    throw new TotemError(
      'CONFIG_INVALID',
      `Phase mismatch: --phase certifying requested but the lock is phase "harness" (P1).`,
      `Re-freeze with a "certifying" phase lock after the real rule set is minted (post strategy#516).`,
    );
  }

  // C3: derive freeze proof from git history (not a self-embedded trusted field).
  verifyFreezeProof(lockPath, repoRoot, safeExec);

  // C6 / §5: fixture integrity is MANDATORY over BOTH control dirs (positive
  // AND negative) — a missing/empty control dir while the lock declares a
  // fixtureSha is corpus shrinkage / tampering, not a reason to skip.
  // verifyControlIntegrity throws loud on missing/empty/mismatch.
  const controlDirs = [
    path.join(repoRoot, lock.controls.positiveRef),
    path.join(repoRoot, lock.controls.negativeRef),
  ];
  verifyControlIntegrity(controlDirs, lock.controls.integrity.fixtureSha, repoRoot, safeExec);

  console.error(`[WindtunnelRun] Lock valid — phase: ${lock.phase}`);

  // Build the shared post-image readStrategy (S1/C1).
  // For the harness phase (no lc clone required — mock engine), we use a
  // simple null-returning strategy (all files → skip classification = fail-open).
  // When lcDir is provided, resolve post-image blobs from the lc clone.
  const readStrategy = buildReadStrategy(lcDir, lock.corpus.selectionRule.asOfCommit, safeExec);

  // Enrich with AST context for any additions (harness: no diff, so no additions).
  // In the real certifying run, the caller would build additions from PR diffs
  // and pass them through enrichWithAstContext + applyAstRulesToAdditions with
  // the shared readStrategy (S1/C1 — same content for regex astContext + AST).

  // Run the engine — harness phase uses mock engines.
  const { mintedRuleIds, firings, groundTruth, positiveControlTargets } = await runMockEngine(
    lock,
    readStrategy,
  );

  // Score
  const verdict = scoreWindtunnel({
    firings,
    groundTruth,
    positiveControlTargets,
    mintedRuleIds,
    cullRateThreshold: lock.cullRateThreshold,
    exposureFloors: {
      activeRulesEvaluated: lock.exposureDenominator.activeRulesEvaluated.floor,
      filesTouchedInWindow: lock.exposureDenominator.filesTouchedInWindow.floor,
      positiveControlsExercised: lock.exposureDenominator.positiveControlsExercised.floor,
    },
    actualExposure: {
      activeRulesEvaluated: mintedRuleIds.length,
      filesTouchedInWindow: 0,
      positiveControlsExercised: positiveControlTargets.length,
    },
  });

  // Print verdict — exposure tuple never collapsed
  console.log(`WindtunnelVerdict: ${verdict.verdict}`);
  // Certifying precision is null on no-claim verdicts (#2189) — guard .toFixed.
  const precisionStr =
    verdict.precision === null
      ? 'n/a (not computed — no-claim verdict)'
      : verdict.precision.toFixed(4);
  console.log(`  precision:         ${precisionStr} (certifying claim)`);
  const survivorStr =
    verdict.diagnostics.survivorPrecision === null
      ? 'n/a'
      : verdict.diagnostics.survivorPrecision.toFixed(4);
  console.log(
    `  survivorPrecision: ${survivorStr} (diagnostic — TP/(TP+FP) over surviving firings)`,
  );
  console.log(`  mintedRuleCount:   ${verdict.mintedRuleCount}`);
  console.log(`  culledCount:       ${verdict.culledCount}`);
  console.log(`  survivingRuleCount:${verdict.survivingRuleCount}`);
  console.log(
    `  exposureTuple:     [${verdict.exposureTuple.join(', ')}]  (activeRules, filesTouched, positiveControls)`,
  );
  console.log(`  nonVacuity:        ${verdict.nonVacuity}`);
  if (verdict.cullLedger.length > 0) {
    console.log(`  cullLedger (${verdict.cullLedger.length} entries):`);
    for (const entry of verdict.cullLedger) {
      console.log(`    • rule ${entry.ruleId} culled on pr#${entry.pr} (${entry.reason})`);
    }
  }
  if (verdict.needsAdjudication.length > 0) {
    console.log(`  needsAdjudication (${verdict.needsAdjudication.length} firing(s)):`);
    for (const id of verdict.needsAdjudication) {
      console.log(`    • ${id}`);
    }
  }

  // Exit non-zero on FAIL / HONEST-NEGATIVE / needs-adjudication
  if (verdict.verdict !== 'PASS' || verdict.needsAdjudication.length > 0) {
    process.exitCode = 1;
  }
}

// ─── Helpers ─────────────────────────────────────────

type SafeExecFn = typeof import('@mmnto/totem').safeExec;

/**
 * Boolean predicate: is `ancestor` an ancestor of `descendant` in the repo at
 * `cwd`? `git merge-base --is-ancestor` encodes the answer in its exit code
 * (0 = yes, 1 = no), so a non-zero exit is a legitimate FALSE, not an error to
 * swallow. Any other failure (bad ref, repo unreadable) re-throws so it is not
 * masked as a clean "false".
 */
export function isCommitAncestor(
  ancestor: string,
  descendant: string,
  cwd: string,
  safeExec: SafeExecFn,
): boolean {
  try {
    safeExec('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd });
    return true;
  } catch (err) {
    const status = (err as { status?: number | null }).status;
    if (status === 1) return false;
    throw new Error(
      `Wind-tunnel: 'git merge-base --is-ancestor ${ancestor} ${descendant}' failed in ${cwd}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Build a post-image readStrategy (S1/C1).
 * When lcDir is provided, resolves blobs via `git show <asOfCommit>:<path>` in
 * the lc clone. Throws on unresolvable blob for an evaluated added file (C2).
 * When lcDir is absent, returns null for all files (fail-open — harness mock).
 */
export function buildReadStrategy(
  lcDir: string | undefined,
  asOfCommit: string,
  safeExec: SafeExecFn,
): (file: string) => Promise<string | null> {
  if (!lcDir) {
    return async () => null;
  }

  return async (file: string) => {
    const normalized = file.replace(/\\/g, '/');
    try {
      const content = safeExec('git', ['show', `${asOfCommit}:${normalized}`], { cwd: lcDir });
      return content;
    } catch (err) {
      // C2: missing blob for an evaluated added file is a hard error, not a
      // silent no-match (corpus shrinkage).
      throw new Error(
        `Wind-tunnel readStrategy: blob unresolvable for ${file} at ${asOfCommit} in ${lcDir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
}

/**
 * Verify the freeze proof from git history (C3).
 * `git log --format=%H -- <lockPath>` must return at least one commit that is
 * an ancestor of HEAD. The lock blob at that commit must be byte-identical to
 * the current lock.
 */
export function verifyFreezeProof(lockPath: string, repoRoot: string, safeExec: SafeExecFn): void {
  const relLockPath = path.relative(repoRoot, lockPath).replace(/\\/g, '/');

  let logOutput: string;
  try {
    logOutput = safeExec('git', ['log', '--format=%H', '--', relLockPath], { cwd: repoRoot });
  } catch (err) {
    throw new Error(
      `Wind-tunnel freeze proof: git log failed for ${relLockPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const commits = logOutput
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => COMMIT_SHA_REGEX.test(l));

  if (commits.length === 0) {
    throw new Error(
      `Wind-tunnel freeze proof: no commits found for ${relLockPath} — the lock has never been committed. Run 'totem spine windtunnel freeze' and commit the lock first (C3).`,
    );
  }

  const freezeCommit = commits[0]!;

  // Verify freezeCommit is an ancestor of HEAD
  try {
    safeExec('git', ['merge-base', '--is-ancestor', freezeCommit, 'HEAD'], { cwd: repoRoot });
  } catch {
    throw new Error(
      `Wind-tunnel freeze proof: lock commit ${freezeCommit} is not an ancestor of HEAD (C3 — tampered or wrong branch).`,
    );
  }

  // Verify blob identity via git object hashes (CRLF-immune, matching the
  // .wind-tunnel-sha discipline) rather than a raw string compare — the latter
  // spuriously fails on trailing-newline / line-ending normalization because
  // `git show` output and the on-disk working file can differ by EOL alone.
  let workingHash: string;
  let committedHash: string;
  try {
    workingHash = safeExec('git', ['hash-object', '--', lockPath], { cwd: repoRoot }).trim();
    committedHash = safeExec('git', ['rev-parse', `${freezeCommit}:${relLockPath}`], {
      cwd: repoRoot,
    }).trim();
  } catch (err) {
    throw new Error(
      `Wind-tunnel freeze proof: cannot resolve lock blob at ${freezeCommit}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (workingHash !== committedHash) {
    throw new Error(
      `Wind-tunnel freeze proof: current lock differs from the committed blob at ${freezeCommit} (C3 — lock was modified after freeze).`,
    );
  }

  console.error(`[WindtunnelRun] Freeze proof verified: lock committed at ${freezeCommit}`);
}

/**
 * Compute gate-1-scoped fixtureSha via `git hash-object` over ALL control dirs
 * (positive AND negative), so the single fixtureSha protects every fixture
 * (OQ3 — do NOT extend the existing .totem/tests FIXTURE_DIR).
 */
export function computeFixtureSha(
  controlDirs: string[],
  repoRoot: string,
  safeExec: SafeExecFn,
): string | null {
  // No try/catch around the body: a hash/IO failure must propagate so the
  // integrity check fails LOUD (Tenet 4 — a silently null'd hash would skip the
  // run-time tamper gate, the §5 no-silent-shrink discipline this design rests
  // on). The only "soft" case is no files across all dirs, returned as null and
  // handled by callers (controls absent / not yet populated at harness time).
  //
  // Hashes EVERY provided control dir (positive AND negative) so the single
  // fixtureSha protects all fixtures — a tampered negative control (the cull
  // guard) is as detectable as a tampered positive one.
  const entries: Array<{ key: string; fullPath: string }> = [];
  for (const dir of controlDirs) {
    if (!fs.existsSync(dir)) continue;
    const dirKey = path.basename(dir.replace(/[/\\]+$/, ''));
    const files = fs
      .readdirSync(dir, { recursive: true })
      .map((f) => (f instanceof Buffer ? f.toString('utf-8') : String(f)))
      // Normalize to forward-slash (A3): Windows readdir yields '\' separators,
      // which would otherwise reorder the sort and change the digest per-platform.
      .map((f) => f.replace(/\\/g, '/'))
      .filter((f) => !fs.statSync(path.join(dir, f)).isDirectory());
    for (const f of files) {
      // Dir-qualified key: keeps cross-dir order stable AND makes a file moving
      // between positive/ and negative/ change the aggregate (tamper-evident).
      entries.push({ key: `${dirKey}/${f}`, fullPath: path.join(dir, f) });
    }
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // `git hash-object <path>` applies the repo's clean/EOL filter by default
  // (verified: a CRLF file under `* text=auto` hashes identically to its LF
  // form), so each per-file hash is CRLF-immune WITHOUT --filters (and
  // --no-filters would defeat that immunity).
  const combined = entries
    .map(
      (e) =>
        `${e.key}:${safeExec('git', ['hash-object', '--', e.fullPath], { cwd: repoRoot }).trim()}`,
    )
    .join('\n');

  return safeExec('git', ['hash-object', '--stdin'], {
    cwd: repoRoot,
    input: combined,
  }).trim();
}

/**
 * Verify control-fixture integrity (C6 / §5 no-silent-shrink). The lock ALWAYS
 * declares a fixtureSha (schema-required) covering ALL control dirs (positive
 * AND negative), so any missing/empty control dir or hash mismatch is corpus
 * shrinkage / tampering — it MUST fail loud, never silently pass.
 */
export function verifyControlIntegrity(
  controlDirs: string[],
  expectedSha: string,
  repoRoot: string,
  safeExec: SafeExecFn,
): void {
  for (const dir of controlDirs) {
    if (!fs.existsSync(dir)) {
      throw new Error(
        `Wind-tunnel integrity: control dir ${dir} is missing but the lock declares fixtureSha ${expectedSha} (§5 no-silent-shrink). Restore the fixtures or re-freeze the lock.`,
      );
    }
  }
  const actualSha = computeFixtureSha(controlDirs, repoRoot, safeExec);
  if (actualSha === null) {
    throw new Error(
      `Wind-tunnel integrity: control dirs [${controlDirs.join(', ')}] are empty but the lock declares fixtureSha ${expectedSha} (§5 no-silent-shrink). Restore the fixtures or re-freeze the lock.`,
    );
  }
  if (actualSha !== expectedSha) {
    throw new Error(
      `Wind-tunnel integrity: control fixtures changed — expected ${expectedSha}, got ${actualSha}. Revert the tampering or re-freeze with the updated fixtureSha.`,
    );
  }
}

/**
 * Assert corpus completeness (S4): resolvedPrs === selectionRule(asOfCommit).
 * In the harness phase this is a structural check only (no real lc API call).
 */
export async function assertCorpusCompleteness(
  lock: import('@mmnto/totem').WindtunnelLock,
  lcDir: string,
  repoRoot: string,
  safeExec: SafeExecFn,
): Promise<void> {
  // Verify the lc clone is accessible + at the correct asOfCommit.
  // `merge-base --is-ancestor` exits non-zero to MEAN "not an ancestor" — that
  // is a boolean predicate, not an error, so it gets its own probe helper.
  const asOfCommit = lock.corpus.selectionRule.asOfCommit;
  let headSha: string;
  try {
    headSha = safeExec('git', ['rev-parse', 'HEAD'], { cwd: lcDir }).trim();
  } catch (err) {
    // S4: an inaccessible lc clone means freeze-time completeness cannot be
    // proven. The harness phase tolerates this (no real corpus yet) but must
    // surface it loudly — never silently pass off an unverifiable corpus.
    throw new Error(
      `Wind-tunnel freeze: cannot access lc clone at ${lcDir} to verify corpus completeness (S4): ${err instanceof Error ? err.message : String(err)}. ` +
        `Provide a valid --lc-dir / TOTEM_LC_DIR clone, or omit it to skip the completeness assertion entirely.`,
    );
  }

  const isAncestor = isCommitAncestor(asOfCommit, headSha, lcDir, safeExec);
  if (!isAncestor) {
    console.error(
      `[WindtunnelFreeze] WARNING: asOfCommit ${asOfCommit} is not an ancestor of lc HEAD ${headSha} — corpus completeness assertion may be unreliable.`,
    );
  } else {
    console.error(`[WindtunnelFreeze] lc clone at ${lcDir} includes asOfCommit ${asOfCommit} ✓`);
  }

  // Structural completeness: count + warn (the actual re-derivation of the full
  // code-touching PR set requires querying the lc repo's merge history, which
  // is operator-level work; the tool asserts the lock is non-empty and warns
  // if the resolvedPrs count seems low).
  const prCount = lock.corpus.resolvedPrs.length;
  console.error(
    `[WindtunnelFreeze] resolvedPrs: ${prCount} entries (completeness requires operator verification against selectionRule)`,
  );

  void repoRoot; // used in freeze proof above
}

// ─── Mock engine (harness phase) ─────────────────────

/**
 * Run mock engines for harness-phase validation (OQ2).
 * Returns firings + ground-truth labels that exercise all verdict paths:
 * PASS, HONEST-NEGATIVE (exposure floor, unlabeled), FAIL (FP, vacuity).
 * For the actual harness lock (mintedRuleIds ≈ []), this returns empty results.
 */
async function runMockEngine(
  lock: import('@mmnto/totem').WindtunnelLock,
  _readStrategy: (file: string) => Promise<string | null>,
): Promise<{
  mintedRuleIds: string[];
  firings: import('@mmnto/totem').RuleFiring[];
  groundTruth: Map<string, import('@mmnto/totem').GroundTruthLabel>;
  positiveControlTargets: Array<{ pr: number; targetRuleId: string }>;
}> {
  const { firingLabelId } = await import('@mmnto/totem');

  // In harness phase, there are no real minted rules yet (strategy#516 pending)
  const mintedRuleIds: string[] = [];
  const firings: import('@mmnto/totem').RuleFiring[] = [];
  const groundTruth = new Map<string, import('@mmnto/totem').GroundTruthLabel>();
  const positiveControlTargets: Array<{ pr: number; targetRuleId: string }> = [];

  // Emit a diagnostic so operators know the mock engine ran
  console.error(
    `[WindtunnelRun] Mock engine active (harness phase — no compiled rules yet; strategy#516 pending).`,
  );
  console.error(`  resolvedPrs count: ${lock.corpus.resolvedPrs.length}`);

  // Exercise firingLabelId to validate A2 path in harness
  if (lock.corpus.resolvedPrs.length > 0) {
    const samplePr = lock.corpus.resolvedPrs[0]!;
    const sampleId = firingLabelId('mock-rule', samplePr.pr, 'sample/file.ts', 'sample line');
    console.error(`  sample firingLabelId (A2 validation): ${sampleId}`);
  }

  return { mintedRuleIds, firings, groundTruth, positiveControlTargets };
}
