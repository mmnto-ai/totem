import { createRequire } from 'node:module';

// ─── Constants ──────────────────────────────────────────

const TAG = 'ClaimDiscipline';
const BYPASS_ENV_VAR = 'TOTEM_GATE_BYPASS_JUSTIFICATION';

/**
 * Discovery convention: WWND rules are recognized by their lesson heading
 * starting with this prefix. Authoring discipline keeps the prefix in sync
 * with the proposal scope (`.totem/lessons/wwnd-rule-*.md`).
 *
 * Filename-based discovery (glob `.totem/lessons/wwnd-*.md`) was considered
 * but would require a lesson-on-disk → compiled-rule-hash mapping pass at
 * runtime; heading-prefix lookup is one-pass against the already-loaded rule
 * set.
 */
const WWND_HEADING_PREFIX = 'WWND Rule ';

/**
 * In-scope public claim surfaces per Proposal 279 § Scope. The gate fires
 * only when these files exist in the repo; the rules themselves carry
 * narrower `fileGlobs` for the actual match dispatch.
 */
const WWND_LITERAL_SURFACES = ['README.md', 'AGENTS.md', 'design-tenets.md'] as const;
const WWND_GLOB_SURFACES = ['docs/wiki/**'] as const;

// ─── Types ──────────────────────────────────────────────

export interface ClaimDisciplineFinding {
  ruleId: string;
  ruleHeading: string;
  file: string;
  line: number;
  match: string;
  severity: 'error' | 'warning';
}

export interface ClaimDisciplineResult {
  /** False only when an `error`-severity finding fires AND no bypass is recorded. */
  valid: boolean;
  findings: ClaimDisciplineFinding[];
  warnings: string[];
  /** True when TOTEM_GATE_BYPASS_JUSTIFICATION is set with non-empty value. */
  bypassed: boolean;
  /** Verbatim justification text when bypassed; undefined otherwise. */
  bypassJustification?: string;
}

export interface ClaimDisciplineOptions {
  /** Override env reading for tests (production uses process.env). */
  envForTest?: NodeJS.ProcessEnv;
  /** Override file discovery for tests (production walks WWND surfaces on disk). */
  filesForTest?: string[];
  /** Override repo root for tests (production calls resolveGitRoot). */
  repoRootForTest?: string;
  /**
   * When provided, narrow the in-scope WWND surface set to the intersection of
   * (literal+glob walk) AND `changedFiles`. Paths must be posix-style (forward
   * slashes), repo-root-relative — same shape as `git diff --name-only` output.
   *
   * `undefined` preserves the standing-gate behavior (full surface scan).
   * Empty array means "no diff-touched WWND surfaces" → no findings.
   *
   * Anchor: mmnto-ai/totem#2002 — pre-existing WWND warnings at standing-gate
   * surfaces (e.g. `docs/wiki/governing-ai-agents.md:58`) fire on every push
   * regardless of diff scope. Diff-scope narrowing prevents that scope bug
   * without papering over it via an allowlist.
   */
  changedFiles?: readonly string[];
}

// ─── Discovery helpers ──────────────────────────────────

interface WwndRule {
  lessonHash: string;
  lessonHeading: string;
  pattern: RegExp;
  severity: 'error' | 'warning';
  fileGlobs?: readonly string[];
}

interface CompiledRuleLike {
  lessonHash: unknown;
  lessonHeading: unknown;
  pattern: unknown;
  engine?: unknown;
  severity?: 'error' | 'warning';
  fileGlobs?: unknown;
  status?: unknown;
}

/**
 * Filter the loaded rule set to WWND rules, validate the regex, and
 * project to a tighter shape used by the scan loop. Silently skip rules
 * with invalid regex (logged via the warnings collector at the caller).
 */
function discoverWwndRules(rules: readonly CompiledRuleLike[], warnings: string[]): WwndRule[] {
  const out: WwndRule[] = [];
  for (const rule of rules) {
    // Runtime type guards — `loadCompiledRules` validates schema, but cast-at-boundary
    // means malformed disk data could still slip through. Defense-in-depth guards
    // degrade gracefully instead of throwing during pre-push gating.
    if (typeof rule.lessonHeading !== 'string') continue;
    if (typeof rule.lessonHash !== 'string') continue;
    if (typeof rule.pattern !== 'string') continue;
    if (!rule.lessonHeading.startsWith(WWND_HEADING_PREFIX)) continue;
    if (rule.engine !== undefined && rule.engine !== 'regex') {
      // Non-regex WWND rules (ast / ast-grep) need engine-specific dispatch
      // not yet implemented in PR α; flag explicitly so PR β knows to wire it.
      warnings.push(
        `WWND rule '${rule.lessonHeading}' uses engine '${String(rule.engine)}' which is not yet supported by the claim-discipline scanner. Rule skipped.`,
      );
      continue;
    }
    if (rule.status !== undefined && rule.status !== 'active') continue;
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, 'g');
      // totem-context: invalid-regex is recorded as a warning + skipped, not silently swallowed; this is the sensor pattern (record + continue with the rest of the rule set)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `WWND rule '${rule.lessonHeading}' has invalid regex '${rule.pattern}': ${msg}. Rule skipped.`,
      );
      continue;
    }
    // Filter fileGlobs to known-string entries; absent or non-array → undefined.
    const safeFileGlobs = Array.isArray(rule.fileGlobs)
      ? rule.fileGlobs.filter((g): g is string => typeof g === 'string' && g.length > 0)
      : undefined;
    out.push({
      lessonHash: rule.lessonHash,
      lessonHeading: rule.lessonHeading,
      pattern: regex,
      severity: rule.severity ?? 'warning',
      fileGlobs: safeFileGlobs,
    });
  }
  return out;
}

// ─── Scan loop ──────────────────────────────────────────

function scanFile(
  filePath: string,
  relPath: string,
  rules: readonly WwndRule[],
  matchesGlob: (path: string, glob: string) => boolean,
  readFile: (p: string) => string,
  sanitizeForTerminal: (s: string) => string,
): ClaimDisciplineFinding[] {
  const findings: ClaimDisciplineFinding[] = [];
  let content: string;
  try {
    content = readFile(filePath);
    // totem-context: unreadable files (permission, transient FS error) are not a finding class — skip silently and continue scanning the rest of the surface set
  } catch (err) {
    void err;
    return findings;
  }

  const lines = content.split('\n');

  for (const rule of rules) {
    // Honor per-rule fileGlobs when present; absent globs mean "applies to
    // any in-scope surface" (the scanner's outer surface-filter is the gate).
    if (rule.fileGlobs && rule.fileGlobs.length > 0) {
      const include = rule.fileGlobs.some((g) => matchesGlob(relPath, g));
      if (!include) continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      // matchAll iterates without the manual lastIndex bookkeeping that
      // RegExp.exec requires; clean per-line scan with no zero-width-loop
      // hazard.
      for (const m of line.matchAll(rule.pattern)) {
        findings.push({
          ruleId: rule.lessonHash,
          ruleHeading: rule.lessonHeading,
          file: relPath,
          line: i + 1,
          // Sanitize-at-source: README/AGENTS prose is untrusted (could carry terminal
          // control sequences). Sanitize once here so downstream consumers (ledger writer,
          // CLI logger) all get safe text. Same hardening pattern verify-badges uses.
          match: sanitizeForTerminal(m[0]),
          severity: rule.severity,
        });
      }
    }
  }

  return findings;
}

// ─── Filesystem walk (zero-dep alternative to glob package) ─

function walkMarkdown(
  absDir: string,
  relPrefix: string,
  out: string[],
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
): void {
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const absChild = path.join(absDir, entry.name);
    const relChild = path.posix.join(relPrefix, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(absChild, relChild, out, fs, path);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(relChild);
    }
  }
}

// ─── Telemetry ──────────────────────────────────────────

async function emitTelemetry(
  repoRoot: string,
  findings: readonly ClaimDisciplineFinding[],
  bypassed: boolean,
  bypassJustification: string | undefined,
): Promise<void> {
  if (findings.length === 0) return;
  try {
    const { appendLedgerEvent } = await import('@mmnto/totem');
    const path = await import('node:path');
    const totemDir = path.join(repoRoot, '.totem');
    // Read the CLI's own version once per invocation — same pattern as
    // `packages/cli/src/index.ts` and `run-compiled-rules.ts`.
    let cliVersion: string | undefined;
    try {
      const req = createRequire(import.meta.url);
      const pkg = req('../../package.json') as { version?: string };
      cliVersion = pkg.version;
      // totem-context: cli_version is a best-effort enrichment of the ledger event; failure to resolve package.json must not block the gate
    } catch (err) {
      void err;
    }
    // `justification` is intentionally an empty string for the non-bypass
    // path. The LedgerEventSchema declares `justification: z.string().default('')`
    // (no `.min(1)`), so empty strings are valid input. Audit consumers that
    // need to find bypassed events filter on `.justification != ""` rather
    // than treating absence as the signal — keeps the on-disk shape consistent
    // across event types where empty justification is the norm
    // (`suppress`, `override`, `exemption` all write `''` on the no-context path).
    const justification = bypassed && bypassJustification !== undefined ? bypassJustification : '';
    for (const f of findings) {
      appendLedgerEvent(totemDir, {
        timestamp: new Date().toISOString(),
        type: 'claim_discipline_finding',
        ruleId: f.ruleId,
        file: f.file,
        line: f.line,
        activity_name: f.file,
        justification,
        source: 'lint',
        ...(cliVersion !== undefined ? { cli_version: cliVersion } : {}),
      });
    }
    // totem-context: fire-and-forget telemetry; ledger-write failure must not block the gate per the A.3.a writer-contract pattern
  } catch (err) {
    void err;
  }
}

// ─── Main command ───────────────────────────────────────

/**
 * Programmatic surface — returns the result without exiting or throwing.
 * The CLI action layer wraps this and throws a `TotemError` when
 * `result.valid === false` so the top-level `handleError` produces the exit
 * code (avoids direct `process.exit()` calls per AGENTS.md doctrine).
 */
export async function doctorClaimDisciplineCommand(
  options: ClaimDisciplineOptions = {},
): Promise<ClaimDisciplineResult> {
  const { loadCompiledRules, matchesGlob, resolveGitRoot, sanitizeForTerminal } =
    await import('@mmnto/totem');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const env = options.envForTest ?? process.env;
  const repoRoot = options.repoRootForTest ?? resolveGitRoot(process.cwd());
  const findings: ClaimDisciplineFinding[] = [];
  const warnings: string[] = [];

  if (!repoRoot) {
    return {
      valid: true,
      findings,
      warnings: ['Not inside a git repo — skipping claim-discipline check.'],
      bypassed: false,
    };
  }

  // ─── Discover in-scope files ─────────────────────────
  let files: string[];
  if (options.filesForTest) {
    files = options.filesForTest;
  } else {
    files = [];
    for (const literal of WWND_LITERAL_SURFACES) {
      const abs = path.join(repoRoot, literal);
      if (fs.existsSync(abs)) files.push(literal);
    }
    // Glob expansion for `docs/wiki/**` is deferred to PR β when the surface
    // becomes load-bearing. For now: recursive walk over docs/wiki/ if it
    // exists, collecting *.md files. Keeps PR α's dep footprint at zero
    // glob libs.
    for (const globRoot of WWND_GLOB_SURFACES) {
      // Strip trailing /** to get the directory prefix
      const dirPart = globRoot.replace(/\/\*\*$/, '');
      const absDir = path.join(repoRoot, dirPart);
      if (!fs.existsSync(absDir)) continue;
      try {
        const collected: string[] = [];
        walkMarkdown(absDir, dirPart, collected, fs, path);
        files.push(...collected);
        // totem-context: walk failure is recorded as a warning, not silently swallowed — sensor pattern (record + continue scanning the literal surfaces)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to walk '${globRoot}': ${msg}`);
      }
    }
  }

  // ─── Diff-scope narrowing (mmnto-ai/totem#2002) ──────
  // When `changedFiles` is provided, narrow the in-scope surface set to the
  // intersection of `(WWND in-scope files)` AND `changedFiles`. Preserves the
  // standing-gate behavior when `undefined`. The CLI layer resolves the diff
  // list via `git diff --name-only --diff-filter=ACMR` and passes posix-style
  // paths here; the literal+glob walk above also emits posix-style paths
  // (`path.posix.join`), so set-membership comparison is path-shape-safe.
  if (options.changedFiles !== undefined) {
    const diffSet = new Set(options.changedFiles);
    files = files.filter((f) => diffSet.has(f));
  }

  if (files.length === 0) {
    // No in-scope surfaces present → nothing to check. Not a failure.
    // Same response applies when diff-scope narrowing eliminates every file
    // (operator's diff doesn't touch any WWND surface), which is the
    // common-case acceptance path for the #2002 fix.
    return { valid: true, findings, warnings, bypassed: false };
  }

  // ─── Load + filter WWND rules ─────────────────────────
  const rulesPath = path.join(repoRoot, '.totem', 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    warnings.push('.totem/compiled-rules.json not found — skipping claim-discipline check.');
    return { valid: true, findings, warnings, bypassed: false };
  }
  // Graceful recovery on corrupt/malformed compiled-rules.json — pre-push gating must
  // not crash on file corruption or partial writes. Empty rule set + warning is the
  // sensor-pattern equivalent of the "no WWND rules found" path below.
  let rules: CompiledRuleLike[];
  try {
    rules = loadCompiledRules(rulesPath) as CompiledRuleLike[];
    // totem-context: load failure is recorded as a warning + recovered-to-empty, not silently swallowed; matches the file-corruption-recovery pattern used elsewhere for config artifacts
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(
      `Failed to load .totem/compiled-rules.json (${msg}) — claim-discipline check skipped. Run 'totem lesson compile' to regenerate.`,
    );
    return { valid: true, findings, warnings, bypassed: false };
  }
  const wwndRules = discoverWwndRules(rules, warnings);

  if (wwndRules.length === 0) {
    warnings.push(
      'No WWND rules found in compiled-rules.json — claim-discipline check is inert until at least one wwnd-* lesson is compiled.',
    );
    return { valid: true, findings, warnings, bypassed: false };
  }

  // ─── Scan ─────────────────────────────────────────────
  for (const relPath of files) {
    const abs = path.join(repoRoot, relPath);
    findings.push(
      // totem-context: gate operates on working-tree content (what the operator is about to push), not staged index — `git show :path` would skip unstaged edits that the gate should still surface
      ...scanFile(
        abs,
        relPath,
        wwndRules,
        matchesGlob,
        (p) => fs.readFileSync(p, 'utf-8'),
        sanitizeForTerminal,
      ),
    );
  }

  // ─── Bypass handling ──────────────────────────────────
  // Sanitize the raw env-var value before downstream use — operators can set arbitrary
  // bytes; the same terminal-control-sequence hardening applies as for `match`.
  const rawJustification = env[BYPASS_ENV_VAR]?.trim();
  const bypassJustification =
    rawJustification !== undefined ? sanitizeForTerminal(rawJustification) : undefined;
  const bypassed = bypassJustification !== undefined && bypassJustification.length > 0;

  // ─── Emit telemetry ───────────────────────────────────
  await emitTelemetry(repoRoot, findings, bypassed, bypassJustification);

  // ─── Determine validity ───────────────────────────────
  const errorFindings = findings.filter((f) => f.severity === 'error');
  const valid = bypassed || errorFindings.length === 0;

  return {
    valid,
    findings,
    warnings,
    bypassed,
    ...(bypassJustification !== undefined ? { bypassJustification } : {}),
  };
}

// ─── CLI entry ──────────────────────────────────────────

export interface ClaimDisciplineCliOptions extends ClaimDisciplineOptions {
  /**
   * Strict mode: promote `warning`-severity findings to gate failures (same
   * semantic as `totem doctor --strict`). Absent the flag, only
   * `error`-severity findings fail the gate. The pre-push hook invokes
   * `--claim-discipline --strict` per Proposal 279 § Implementation Notes Q3.
   *
   * `strict` is CLI-presentation-only — the programmatic `doctorClaimDisciplineCommand`
   * always returns the same findings; this flag controls whether the CLI throws on
   * warning-severity findings. Inherited test-injection fields (`envForTest`,
   * `filesForTest`, `repoRootForTest`) pass through to the programmatic command for
   * integration testing.
   */
  strict?: boolean;
  /**
   * Diff-scope narrowing flag (mmnto-ai/totem#2002). When set, the CLI resolves
   * the operator's diff-touched files via `git diff --name-only --diff-filter=ACMR
   * <merge-base>...HEAD` and forwards the list as `changedFiles` to the
   * programmatic command. Merge-base resolution prefers `git merge-base HEAD
   * @{upstream}`; falls back to `HEAD~1` for unconfigured branches. On total
   * resolution failure (detached HEAD with no parent + no upstream), emits a
   * warning and proceeds with the standing-gate full scan.
   *
   * The pre-push hook passes `--scope-to-diff` so the gate only fires on files
   * the operator's push actually touches — eliminating the #2002 false-positive
   * class where unrelated diffs trigger pre-existing standing-gate warnings.
   */
  scopeToDiff?: boolean;
  /**
   * Test-only injection point for the diff-resolved file list. When set, bypasses
   * the actual `git diff --name-only` invocation and forwards the array directly
   * as `changedFiles`. Production callers leave this `undefined` and rely on
   * `scopeToDiff` to trigger the real git resolution.
   */
  changedFilesForTest?: readonly string[];
}

/**
 * Resolve diff-touched files relative to `repoRoot` via `git diff --name-only
 * --diff-filter=ACMR <merge-base>...HEAD`. Returns `undefined` on resolution
 * failure (no upstream + no `HEAD~1` + detached state); callers should then
 * fall back to the standing-gate full scan and surface a warning.
 *
 * Ref-resolution order:
 *   1. `git merge-base HEAD @{upstream}` — preferred when the branch has an
 *      upstream (the normal pre-push state).
 *   2. `HEAD~1` — fallback when no upstream is configured (fresh branch).
 *   3. Give up — return `undefined`.
 *
 * Diff filter `ACMR` includes Added/Copied/Modified/Renamed; excludes Deleted
 * (a deleted file can't trigger a WWND match) and Type-changed/Unmerged.
 */
function resolveDiffChangedFiles(
  repoRoot: string,
  safeExec: (command: string, args: string[], options: { cwd: string }) => string,
): readonly string[] | undefined {
  // Try `merge-base HEAD @{upstream}` first. The three try/catch blocks below
  // are the canonical sensor pattern: record-via-undefined-return + fall back to
  // the next strategy (and ultimately to standing-gate full scan with an
  // operator-visible warning surfaced by the CLI layer). Loud rethrow here
  // would abort the pre-push gate on a benign "no upstream" or "no parent
  // commit" condition.
  let base: string | undefined;
  try {
    base = safeExec('git', ['merge-base', 'HEAD', '@{upstream}'], { cwd: repoRoot }).trim();
    // totem-context: intentional cleanup — `merge-base @{upstream}` failure is the expected fall-through signal when no upstream is configured (fresh branch); next strategy below.
  } catch {
    // No upstream / detached / etc — fall through to HEAD~1.
  }
  if (!base) {
    try {
      base = safeExec('git', ['rev-parse', 'HEAD~1'], { cwd: repoRoot }).trim();
      // totem-context: intentional cleanup — `rev-parse HEAD~1` failure means no parent commit (single-commit branch); returning undefined here signals "diff resolution failed entirely" so the CLI falls back to standing-gate full scan with an operator-visible warning.
    } catch {
      return undefined;
    }
  }
  if (!base) return undefined;
  try {
    const output = safeExec(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`],
      // 10MB matches the cohort convention for git operations
      // (`packages/core/src/sys/git.ts`); prevents `ENOBUFS` on
      // repos with many changed files between the base and HEAD.
      { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    return output
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // totem-context: intentional cleanup — `git diff` failure (resolved base became stale, repo corruption, etc.) returns undefined so the CLI falls back to standing-gate full scan with an operator-visible warning, rather than aborting the pre-push gate entirely.
  } catch {
    return undefined;
  }
}

/**
 * CLI entry — wraps `doctorClaimDisciplineCommand` and throws on hard
 * failure so the top-level `handleError` produces the non-zero exit code
 * without a direct `process.exit` call. Warning-severity findings are
 * reported to the user; they fail the gate only under `--strict`.
 */
export async function doctorClaimDisciplineCliCommand(
  options: ClaimDisciplineCliOptions = {},
): Promise<void> {
  const { TotemError, resolveGitRoot, safeExec } = await import('@mmnto/totem');
  const {
    bold,
    errorColor,
    log,
    success: successColor,
    warn: warnColor,
  } = await import('../ui.js');

  // Strip CLI-only fields (`strict`, `scopeToDiff`, `changedFilesForTest`) before
  // passing the rest through to the programmatic command, which doesn't accept them.
  // Remaining fields (envForTest / filesForTest / repoRootForTest / changedFiles) are
  // inherited from ClaimDisciplineOptions and form the integration test surface.
  const { strict, scopeToDiff, changedFilesForTest, ...programmaticOptions } = options;

  // Resolve diff scope when `--scope-to-diff` is set (or test-injection short-circuit).
  // mmnto-ai/totem#2002 — narrowing the standing-gate scan to diff-touched files
  // prevents pre-existing surface warnings from firing on unrelated pushes.
  let resolvedChangedFiles: readonly string[] | undefined = programmaticOptions.changedFiles;
  if (resolvedChangedFiles === undefined && changedFilesForTest !== undefined) {
    resolvedChangedFiles = changedFilesForTest;
  } else if (resolvedChangedFiles === undefined && scopeToDiff === true) {
    const repoRoot =
      programmaticOptions.repoRootForTest ?? resolveGitRoot(process.cwd()) ?? process.cwd();
    const resolved = resolveDiffChangedFiles(repoRoot, safeExec);
    if (resolved === undefined) {
      log.warn(
        TAG,
        '--scope-to-diff requested but no diff range could be resolved (no upstream, no HEAD~1). Falling back to standing-gate full scan.',
      );
    } else {
      resolvedChangedFiles = resolved;
    }
  }

  const result = await doctorClaimDisciplineCommand({
    ...programmaticOptions,
    ...(resolvedChangedFiles !== undefined ? { changedFiles: resolvedChangedFiles } : {}),
  });

  for (const w of result.warnings) {
    log.warn(TAG, w);
  }

  if (result.findings.length === 0) {
    log.success(TAG, `${successColor(bold('PASS'))} — no claim-discipline findings.`);
    return;
  }

  // Report findings to the user. Warnings go through the warn channel;
  // errors through the error channel; both surface the file:line:match.
  for (const f of result.findings) {
    const tag = f.severity === 'error' ? errorColor(bold('ERROR')) : warnColor(bold('WARN'));
    const msg = `${tag} ${f.file}:${f.line} — [${f.ruleHeading}] matched "${f.match}"`;
    if (f.severity === 'error') log.error(TAG, msg);
    else log.warn(TAG, msg);
  }

  if (result.bypassed) {
    log.warn(
      TAG,
      `${warnColor(bold('BYPASSED'))} — TOTEM_GATE_BYPASS_JUSTIFICATION set; ${result.findings.length} finding(s) recorded but gate passed.`,
    );
    return;
  }

  const errorCount = result.findings.filter((f) => f.severity === 'error').length;
  const warningCount = result.findings.filter((f) => f.severity === 'warning').length;

  if (!result.valid) {
    throw new TotemError(
      'CLAIM_DISCIPLINE_FAILED',
      `${errorCount} error-severity claim-discipline finding(s).`,
      'Fix each error finding above by adjusting the prose (name the structural backing, soften to present-tense intent, or add the required field). To bypass once with audit trail: set TOTEM_GATE_BYPASS_JUSTIFICATION="<reason>" before pushing.',
    );
  }

  // Strict mode promotes warnings to gate failures (Proposal 279 § Implementation Notes Q3
  // — the pre-push hook invokes `--claim-discipline --strict` and expects warnings to fail
  // the push when present).
  if (strict && warningCount > 0) {
    throw new TotemError(
      'CLAIM_DISCIPLINE_FAILED',
      `${warningCount} warning-severity claim-discipline finding(s) under --strict.`,
      'Fix each warning finding above (name the structural backing inline, or soften to present-tense intent). To bypass once with audit trail: set TOTEM_GATE_BYPASS_JUSTIFICATION="<reason>" before pushing.',
    );
  }

  // Warning-only findings outside strict mode — print summary but don't throw.
  if (warningCount > 0) {
    log.warn(
      TAG,
      `${warnColor(bold('WARN'))} — ${warningCount} warning-severity finding(s) recorded; pass --strict (or set TOTEM_GATE_BYPASS_JUSTIFICATION) to gate on warnings.`,
    );
  }
}
