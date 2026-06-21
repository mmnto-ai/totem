import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PrMeta, SelectionRuleConfig, WindtunnelLock } from '@mmnto/totem';

import { persistCertifyingOutcome } from './spine-cert-persist.js';

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
  /**
   * 5c-ii injection seam (out of 5c-i scope to populate): the certifying corpus
   * — resolved-PR diffs (corpus + controls), the active compiled rules, and the
   * frozen ground-truth labels. When omitted on a certifying run, the real
   * engine path throws a structured "corpus provider not wired" error rather
   * than silently scoring an empty set. 5c-ii (the orchestrator) supplies the
   * live-recorded corpus here; 5c-i unit tests supply a deterministic fixture.
   */
  certifyingCorpus?: CertifyingCorpusProvider;
}

/**
 * The certifying corpus the real engine scores (5c-ii supplies this; 5c-i
 * defines the seam + the deterministic engine that consumes it). Returns the
 * active compiled rules (archived MUST be excluded — fold-F throws otherwise),
 * the resolved-PR diffs (corpus + positive/negative controls), and the frozen
 * ground-truth labels keyed by firingLabelId.
 */
export type CertifyingCorpusProvider = (
  lock: WindtunnelLock,
) => Promise<CertifyingCorpus> | CertifyingCorpus;

export interface CertifyingCorpus {
  rules: import('@mmnto/totem').CompiledRule[];
  prDiffs: import('@mmnto/totem').ResolvedPrDiff[];
  groundTruth: Map<string, import('@mmnto/totem').GroundTruthLabel>;
  /**
   * Mining provenance per rule (lessonHash → provenance) — supplied by the
   * orchestrator from the candidate/emission records. fold-B needs it to stamp
   * legitimacy; a survivor without provenance is surfaced as a skip, never
   * fabricated.
   */
  provenanceByRule: Map<string, import('@mmnto/totem').ProvenanceRecord>;
}

/** Internal shape the run command's scorer + persist step consume (engine-agnostic). */
interface EngineResult {
  mintedRuleIds: string[];
  firings: import('@mmnto/totem').RuleFiring[];
  groundTruth: Map<string, import('@mmnto/totem').GroundTruthLabel>;
  positiveControlTargets: Array<{ pr: number; targetRuleId: string }>;
  /** C2 — real touched-file exposure (0 for the harness mock). */
  filesTouchedInWindow: number;
  /** Candidate rules eligible for fold-B stamping (empty for the harness mock). */
  candidates: import('@mmnto/totem').CompiledRule[];
  /** Mining provenance per rule for fold-B (empty for the harness mock). */
  provenanceByRule: Map<string, import('@mmnto/totem').ProvenanceRecord>;
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

  // Run the engine. Harness phase → mock engine (no real rules yet). Certifying
  // phase → the REAL engine path (5c-i): build additions from each resolved-PR
  // diff → enrichWithAstContext + applyAstRulesToAdditions with the shared
  // post-image readStrategy → RuleFiring[] → A1 unique-label hard-gate → score.
  // C2: filesTouchedInWindow is the real exposure computed from the diffs (no
  // longer the hard-coded 0).
  const engineResult =
    lock.phase === 'certifying'
      ? await runCertifyingEngine(lock, readStrategy, opts.certifyingCorpus)
      : await runMockEngineAdapter(lock, readStrategy);

  const { mintedRuleIds, firings, groundTruth, positiveControlTargets, filesTouchedInWindow } =
    engineResult;

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
      filesTouchedInWindow,
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

  // 5c-ii: certifying-phase persistence — fold-B project → fold-C parse-before-write
  // persist (PASS-survivors-only) + the transient cert-run report (§6 L3). The
  // repo's live `.totem/compiled-rules.json` is NEVER touched here; survivors land
  // in the gate-1 cert output, which strategy#516 promotes to the live corpus.
  if (lock.phase === 'certifying') {
    const gate1Dir = path.join(repoRoot, '.totem', 'spine', 'gate-1');
    const persistResult = await persistCertifyingOutcome({
      verdict,
      firings,
      mintedRuleIds,
      positiveControlTargets,
      candidates: engineResult.candidates,
      provenanceByRule: engineResult.provenanceByRule,
      certifiedRulesOutPath: path.join(gate1Dir, 'compiled-rules.json'),
      reportDir: path.join(gate1Dir, 'run-reports'),
      nowIso: new Date().toISOString(),
      asOfCommit: lock.corpus.selectionRule.asOfCommit,
    });
    console.error(
      `[WindtunnelRun] Cert-run report: ${persistResult.reportPath}` +
        (persistResult.persisted
          ? ` — ${persistResult.stampedCount} survivor(s) stamped → ${persistResult.certifiedRulesPath}`
          : ` — no rules persisted (verdict ${verdict.verdict}); live corpus untouched`),
    );
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
 * Assert corpus completeness (S4, ADR-110 §6): the manifest's `resolvedPrs` must
 * deep-set-equal `selectionRule(asOfCommit)` re-derived from the offline lc clone.
 *
 * - **Harness phase:** warn-only (no real corpus yet) — surfaces accessibility
 *   but skips the re-derivation.
 * - **Certifying phase:** hard error. Re-derives the code-touching PR set from
 *   lc's squash history and throws on ANY membership/count divergence (§6: a
 *   dropped/added/substituted PR voids the run). Requires a frozen
 *   `codePathClassifier`.
 */
export async function assertCorpusCompleteness(
  lock: WindtunnelLock,
  lcDir: string,
  repoRoot: string,
  safeExec: SafeExecFn,
): Promise<void> {
  const {
    resolveSelectionRule,
    diffPrSets,
    parsePrNumber,
    parseRevertSha,
    isBotIdentity,
    TotemError,
  } = await import('@mmnto/totem');

  const sel = lock.corpus.selectionRule;
  const asOfCommit = sel.asOfCommit;

  // Verify the lc clone is accessible (CRLF-normalized output).
  let headSha: string;
  try {
    headSha = safeExec('git', ['rev-parse', 'HEAD'], { cwd: lcDir }).replace(/\r\n/g, '\n').trim();
  } catch (err) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel freeze: cannot access lc clone at ${lcDir} to verify corpus completeness (S4).`,
      'Provide a valid --lc-dir / TOTEM_LC_DIR clone, or omit it to skip the completeness assertion entirely.',
      err,
    );
  }

  // `merge-base --is-ancestor` encodes the answer in its exit code (boolean), so
  // it gets its own probe helper.
  const isAncestor = isCommitAncestor(asOfCommit, headSha, lcDir, safeExec);

  // Harness phase: no real corpus yet — warn-only, skip the re-derivation.
  if (lock.phase === 'harness') {
    console.error(
      isAncestor
        ? `[WindtunnelFreeze] lc clone includes asOfCommit ${asOfCommit} ✓`
        : `[WindtunnelFreeze] WARNING: asOfCommit ${asOfCommit} is not an ancestor of lc HEAD ${headSha} (harness — re-derivation skipped).`,
    );
    console.error(
      `[WindtunnelFreeze] harness phase — S4 corpus re-derivation skipped (warn-only). resolvedPrs: ${lock.corpus.resolvedPrs.length} entries.`,
    );
    void repoRoot;
    return;
  }

  // Certifying phase: hard-error re-derivation.
  if (!isAncestor) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel freeze (S4, certifying): asOfCommit ${asOfCommit} is not an ancestor of lc HEAD ${headSha} — cannot re-derive the corpus.`,
      'Point --lc-dir at an lc clone whose history includes asOfCommit.',
    );
  }
  if (!sel.codePathClassifier) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel freeze (S4, certifying): corpus.selectionRule.codePathClassifier is required to re-derive the code-touching PR set — there is no safe default for "what counts as code".`,
      'Add a frozen codePathClassifier { includeGlobs, excludeGlobs } to the manifest and re-freeze.',
    );
  }

  const config: SelectionRuleConfig = {
    codePathClassifier: sel.codePathClassifier,
    excludeRevertPairs: sel.excludeRevertPairs,
    excludeBotPrs: sel.excludeBotPrs,
    window: sel.window,
  };
  let metas: PrMeta[];
  try {
    metas = enumeratePrMetas(asOfCommit, lcDir, safeExec, {
      parsePrNumber,
      parseRevertSha,
      isBotIdentity,
    });
  } catch (err) {
    // Any enumeration fault — a malformed PR ref or a truncated/malformed git
    // record — is a config/contract fault in the certifying context. Surface as
    // a TotemError (with cause); never let it escape unwrapped or silently
    // shrink the corpus (greptile + CodeRabbit).
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel freeze (S4): corpus re-derivation failed — ${err instanceof Error ? err.message : String(err)}`,
      'Fix the malformed merge subject / git history in the lc clone, or correct the frozen manifest.',
      err,
    );
  }
  const expected = resolveSelectionRule(metas, config);
  const actual = lock.corpus.resolvedPrs.map((p) => p.pr);
  const diff = diffPrSets(expected, actual);
  if (diff.missing.length > 0 || diff.extra.length > 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Wind-tunnel freeze (S4): corpus completeness FAILED — resolvedPrs ≠ selectionRule(${asOfCommit}).\n` +
        `  Missing from manifest (present in git): [${diff.missing.join(', ')}]\n` +
        `  Extra in manifest (absent from git):     [${diff.extra.join(', ')}]`,
      'Fix the manifest resolvedPrs or codePathClassifier and re-freeze — §6: a corpus divergence voids the run.',
    );
  }
  console.error(
    `[WindtunnelFreeze] S4 corpus completeness VERIFIED: ${expected.length} PR(s) ≡ resolvedPrs ✓`,
  );
  void repoRoot;
}

/**
 * Enumerate merged (squash) PRs reachable from `asOfCommit` in the lc clone as
 * `PrMeta`. lc is 100% squash-merge: each ancestor commit's subject carries a
 * trailing `(#N)`. Commits with no trailing ref are direct-to-main non-PRs and
 * are SKIPPED (not errors); a malformed trailing ref throws (via `parsePrNumber`).
 * All git output is CRLF-normalized before parsing (Windows hygiene).
 */
export function enumeratePrMetas(
  asOfCommit: string,
  lcDir: string,
  safeExec: SafeExecFn,
  helpers: {
    parsePrNumber: (subject: string) => number | null;
    parseRevertSha: (body: string) => string | undefined;
    isBotIdentity: (author: string) => boolean;
  },
): PrMeta[] {
  const F = '\x1f'; // field separator
  const R = '\x1e'; // record separator (LEADS each commit so its trailing file list stays in-record)
  // One `git log --name-only` call — the changed files trail each commit's format
  // block within the same record, avoiding an N+1 `git diff-tree` spawn per commit.
  // `--topo-order` makes the emission order ANCESTRY (topological), not commit-date:
  // a `bounded` window's "most recent N qualifying PRs" must mean N-most-recent-by-
  // ancestry, never by timestamp (ADR-110 §6 ancestry-not-timestamp; strategy-claude
  // 2026-06-18 ruling). Commit dates are non-monotonic and rewritable (rebases, clock
  // skew), so date order would make the window's membership non-deterministic; the
  // reachable SET is unchanged either way, only the order the window slices on. The
  // certifying phase runs `window: all` (order-irrelevant) today, so this hardens the
  // `bounded` path against a future non-linear merge or date-skewed history.
  // `--end-of-options` guards asOfCommit from being parsed as an option even if a
  // future caller passes an unvalidated ref (defense-in-depth; the lock schema
  // already constrains asOfCommit to a 40-hex SHA, and safeExec uses no shell).
  const raw = safeExec(
    'git',
    [
      'log',
      '--topo-order',
      '--name-only',
      `--format=${R}%H${F}%an <%ae>${F}%s${F}%b${F}`,
      '--end-of-options',
      asOfCommit,
    ],
    { cwd: lcDir },
  ).replace(/\r\n/g, '\n');

  const metas: PrMeta[] = [];
  for (const rec of raw.split(R)) {
    if (rec.trim().length === 0) continue;
    const parts = rec.split(F);
    // A real record always has ≥5 F-delimited fields (sha, author, subject,
    // body, files); fewer means truncated/malformed git output. Throw loud
    // rather than silently dropping the PR (corpus shrinkage — the §5 failure
    // mode this gate exists to block, CodeRabbit).
    if (parts.length < 5) {
      throw new Error(
        `Wind-tunnel: malformed git log record (${parts.length} field(s), expected >=5) near "${(parts[0] ?? '').slice(0, 12)}"`,
      );
    }
    // Files trail the LAST field separator; only the body may contain an F, so
    // pop the files block off the end and rejoin the remainder as the body
    // (robust to a vanishingly rare F inside a commit body).
    const filesBlock = parts.pop()!;
    const [sha = '', author = '', subject = '', ...bodyParts] = parts;
    const body = bodyParts.join(F);
    const pr = helpers.parsePrNumber(subject);
    if (pr === null) continue; // no trailing (#N) → direct-to-main non-PR, skip
    metas.push({
      pr,
      mergeCommit: sha.trim().toLowerCase(),
      author: author.trim(),
      isBotAuthor: helpers.isBotIdentity(author),
      revertsSha: helpers.parseRevertSha(body),
      changedFiles: filesBlock
        .split('\n')
        .map((l) => l.trim().replace(/\\/g, '/'))
        .filter(Boolean),
    });
  }
  return metas;
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

/** Adapt the harness mock engine to the EngineResult shape (filesTouched = 0). */
async function runMockEngineAdapter(
  lock: WindtunnelLock,
  readStrategy: (file: string) => Promise<string | null>,
): Promise<EngineResult> {
  const mock = await runMockEngine(lock, readStrategy);
  return {
    ...mock,
    filesTouchedInWindow: 0,
    candidates: [],
    provenanceByRule: new Map(),
  };
}

// ─── Real engine (certifying phase, 5c-i) ────────────

/**
 * Run the REAL engine for the certifying phase (5c-i — #2189 item 1).
 *
 * Replaces the mock for `--phase certifying`: drives each resolved-PR diff
 * through `buildFirings` (core), which runs `enrichWithAstContext` +
 * `applyAstRulesToAdditions` with the shared post-image `readStrategy` (S1/C1)
 * and maps every violation to a `RuleFiring` (content-based labelId). Then:
 *  - **fold-F**: `buildFirings` throws if any archived rule is in the scored set
 *    (the engine never runs on an archived rule).
 *  - **A1 (fold-D)**: `assertUniqueFiringLabels` hard-gates labelId uniqueness
 *    BEFORE scoring (throws on collision, surfacing the offending refs).
 *  - **C2**: `filesTouchedInWindow` is the real distinct-file exposure.
 *  - **fold-H**: neg-control firings flow through as `controlKind:'negative'`;
 *    unlabeled firings route to needsAdjudication via the scorer.
 *
 * The corpus itself (resolved-PR diffs + active rules + frozen ground truth) is
 * supplied by the 5c-ii orchestrator via the `certifyingCorpus` seam. 5c-i owns
 * the deterministic engine; it does NOT fetch/compile live data (out of scope).
 */
export async function runCertifyingEngine(
  lock: WindtunnelLock,
  readStrategy: (file: string) => Promise<string | null>,
  corpusProvider?: CertifyingCorpusProvider,
): Promise<EngineResult> {
  const {
    buildFirings,
    assertUniqueFiringLabels,
    resolveGitRoot,
    TotemError,
    FiringLabelCollisionError,
  } = await import('@mmnto/totem');

  if (!corpusProvider) {
    // No silent empty-set scoring: a certifying run with no corpus provider is a
    // wiring error (5c-ii supplies it). Fail loud + actionable (Tenet 4).
    throw new TotemError(
      'CONFIG_INVALID',
      'Wind-tunnel certifying run: no certifying-corpus provider wired (5c-ii orchestration).',
      'The deterministic real-engine firing path (5c-i) is in place, but the corpus ' +
        '(resolved-PR diffs + compiled rules + ground truth) is supplied by the 5c-ii ' +
        'orchestrator. Run via the certifying orchestrator once it lands.',
    );
  }

  const corpus = await corpusProvider(lock);
  const cwd = resolveGitRoot(process.cwd()) ?? process.cwd();
  const ruleEngineCtx = {
    logger: { warn: (msg: string) => console.error(`[WindtunnelRun] ${msg}`) },
    state: { hasWarnedShieldContext: false },
  };

  // buildFirings runs fold-F (archived assert) internally before the engine; its
  // only throw is ArchivedRuleInScopeError, which propagates. A1 (labelId
  // collision) is deliberately NOT raised here — it is the caller's pre-score gate
  // below (assertUniqueFiringLabels), so the structured per-collision report is
  // threaded there rather than swallowed at construction. (greptile #2215 P2.)
  const built = await buildFirings({
    rules: corpus.rules,
    prDiffs: corpus.prDiffs,
    cwd,
    readStrategy,
    ruleEngineCtx,
    onWarn: (msg) => console.error(`[WindtunnelRun] ${msg}`),
  });

  // A1 (fold-D): post-dedup uniqueness INVARIANT before scoring (Tenet 4).
  // `buildFirings` now collapses same-labelId matches (fold-D dedup), so this can
  // no longer fire on an honest multi-match line — a collision here signals a
  // dedup BUG, not corpus data, so it fails loud as an internal invariant.
  try {
    assertUniqueFiringLabels(built.firings);
  } catch (err) {
    if (err instanceof FiringLabelCollisionError) {
      console.error(`[WindtunnelRun] A1 post-dedup invariant violated (fold-D):`);
      for (const c of err.collisions) {
        console.error(`  • ${c.labelId.slice(0, 12)}… ×${c.evidenceRefs.length}`);
      }
      throw new TotemError(
        'CONFIG_INVALID',
        err.message,
        'A post-dedup firing-label collision is an internal invariant violation: buildFirings ' +
          'should have collapsed same-labelId matches. This indicates a dedup defect, not a corpus issue.',
        err,
      );
    }
    throw err;
  }

  const mintedRuleIds = corpus.rules.map((r) => r.lessonHash);
  console.error(
    `[WindtunnelRun] Certifying engine: ${mintedRuleIds.length} rule(s), ` +
      `${corpus.prDiffs.length} PR diff(s), ${built.firings.length} firing(s), ` +
      `${built.filesTouchedInWindow} file(s) touched.`,
  );

  return {
    mintedRuleIds,
    firings: built.firings,
    groundTruth: corpus.groundTruth,
    positiveControlTargets: built.positiveControlTargets,
    filesTouchedInWindow: built.filesTouchedInWindow,
    candidates: corpus.rules,
    provenanceByRule: corpus.provenanceByRule,
  };
}
