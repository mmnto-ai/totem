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
  lessonHash: string;
  lessonHeading: string;
  pattern: string;
  engine?: string;
  severity?: 'error' | 'warning';
  fileGlobs?: string[];
  status?: string;
}

/**
 * Filter the loaded rule set to WWND rules, validate the regex, and
 * project to a tighter shape used by the scan loop. Silently skip rules
 * with invalid regex (logged via the warnings collector at the caller).
 */
function discoverWwndRules(rules: readonly CompiledRuleLike[], warnings: string[]): WwndRule[] {
  const out: WwndRule[] = [];
  for (const rule of rules) {
    if (!rule.lessonHeading.startsWith(WWND_HEADING_PREFIX)) continue;
    if (rule.engine !== undefined && rule.engine !== 'regex') {
      // Non-regex WWND rules (ast / ast-grep) need engine-specific dispatch
      // not yet implemented in PR α; flag explicitly so PR β knows to wire it.
      warnings.push(
        `WWND rule '${rule.lessonHeading}' uses engine '${rule.engine}' which is not yet supported by the claim-discipline scanner. Rule skipped.`,
      );
      continue;
    }
    if (rule.status !== undefined && rule.status !== 'active') continue;
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, 'g');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `WWND rule '${rule.lessonHeading}' has invalid regex '${rule.pattern}': ${msg}. Rule skipped.`,
      );
      continue;
    }
    out.push({
      lessonHash: rule.lessonHash,
      lessonHeading: rule.lessonHeading,
      pattern: regex,
      severity: rule.severity ?? 'warning',
      fileGlobs: rule.fileGlobs,
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
): ClaimDisciplineFinding[] {
  const findings: ClaimDisciplineFinding[] = [];
  let content: string;
  try {
    content = readFile(filePath);
  } catch {
    // Skip unreadable files; not a finding class.
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
          match: m[0],
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
    } catch (err) {
      void err;
    }
    for (const f of findings) {
      appendLedgerEvent(totemDir, {
        timestamp: new Date().toISOString(),
        type: 'claim_discipline_finding',
        ruleId: f.ruleId,
        file: f.file,
        line: f.line,
        activity_name: f.file,
        justification: bypassed && bypassJustification !== undefined ? bypassJustification : '',
        source: 'lint',
        ...(cliVersion !== undefined ? { cli_version: cliVersion } : {}),
      });
    }
  } catch (err) {
    // totem-context: fire-and-forget telemetry; ledger-write failure must not block the gate
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
  const { loadCompiledRules, matchesGlob, resolveGitRoot } = await import('@mmnto/totem');
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to walk '${globRoot}': ${msg}`);
      }
    }
  }

  if (files.length === 0) {
    // No in-scope surfaces present → nothing to check. Not a failure.
    return { valid: true, findings, warnings, bypassed: false };
  }

  // ─── Load + filter WWND rules ─────────────────────────
  const rulesPath = path.join(repoRoot, '.totem', 'compiled-rules.json');
  if (!fs.existsSync(rulesPath)) {
    warnings.push('.totem/compiled-rules.json not found — skipping claim-discipline check.');
    return { valid: true, findings, warnings, bypassed: false };
  }
  const rules = loadCompiledRules(rulesPath) as CompiledRuleLike[];
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
      ...scanFile(abs, relPath, wwndRules, matchesGlob, (p) => fs.readFileSync(p, 'utf-8')),
    );
  }

  // ─── Bypass handling ──────────────────────────────────
  const bypassJustification = env[BYPASS_ENV_VAR]?.trim();
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

export interface ClaimDisciplineCliOptions {
  /**
   * Strict mode: promote `warning`-severity findings to gate failures (same
   * semantic as `totem doctor --strict`). Absent the flag, only
   * `error`-severity findings fail the gate. The pre-push hook invokes
   * `--claim-discipline --strict` per Proposal 279 § Implementation Notes Q3.
   */
  strict?: boolean;
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
  const { TotemError } = await import('@mmnto/totem');
  const {
    bold,
    errorColor,
    log,
    success: successColor,
    warn: warnColor,
  } = await import('../ui.js');

  const result = await doctorClaimDisciplineCommand();

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
  if (options.strict && warningCount > 0) {
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
