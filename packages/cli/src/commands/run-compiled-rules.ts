import type {
  CompiledRule,
  RuleEventCallback,
  RuleTimeoutOutcome,
  TimeoutMode,
  TotemFinding,
  Violation,
} from '@mmnto/totem';

import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

/**
 * File-level AST parse failure outcome (mmnto-ai/totem#1982). Parallel of
 * {@link RuleTimeoutOutcome} but scoped to the FILE level — when ast-grep's
 * native parser refuses a language (e.g. "rust is not supported in napi"
 * on Windows), the failure cascades to every rule on that file. Granularity
 * is therefore file, not rule.
 *
 * The proper per-file graceful-degrade lives in `mmnto-ai/totem#1786`; this
 * outcome shape exists for the operator-escape `--ast-parse-mode lenient`
 * gap-bridge.
 */
export interface AstParseFailureOutcome {
  file: string;
  /** Language the parser was invoked with (e.g. 'rust', 'python'). */
  language: string;
  /** First 200 chars of the underlying error message. */
  message: string;
  mode: TimeoutMode;
}

export interface RunCompiledRulesOptions {
  diff: string;
  cwd: string;
  totemDir: string;
  format: ShieldFormat;
  outPath?: string;
  exportPaths?: string[];
  ignorePatterns?: string[];
  tag: string;
  /** Absolute path to config root — used for cache paths instead of cwd */
  configRoot?: string;
  /** True if we are linting staged changes only */
  isStaged?: boolean;
  /**
   * Bounded regex execution timeout mode (mmnto-ai/totem#1641). `strict`
   * (default) surfaces regex timeouts as lint errors that contribute to
   * the non-zero exit code. `lenient` skips the timing-out rule-file pair
   * with a visible warning and excludes timeouts from the exit code.
   */
  regexTimeoutMode?: TimeoutMode;
  /**
   * AST parse failure mode (mmnto-ai/totem#1982). `strict` (default)
   * surfaces a `TotemParseError` from the AST pipeline (e.g. ast-grep
   * native parser refusing an unsupported language) as a lint error.
   * `lenient` skips ALL AST rules for the rest of the run with a visible
   * warning and records the failure in `astParseFailures`. Note the
   * asymmetry vs. `regexTimeoutMode`: AST lenient is run-wide because
   * the parse failure escapes the per-file loop in core; per-file
   * graceful-degrade is `mmnto-ai/totem#1786`'s lane.
   */
  astParseMode?: TimeoutMode;
}

export interface RunCompiledRulesResult {
  violations: Violation[];
  /** Unified findings (ADR-071) — same data as violations, normalized shape */
  findings: TotemFinding[];
  rules: CompiledRule[];
  output: string;
  /**
   * Any regex rule-file pairs that timed out during bounded evaluation
   * (mmnto-ai/totem#1641). Empty on healthy runs. Strict mode expects the
   * CLI caller to fail non-zero when non-empty; lenient mode emits
   * warnings only.
   */
  regexTimeouts: RuleTimeoutOutcome[];
  /**
   * AST parse failures captured in lenient mode (mmnto-ai/totem#1982).
   * Always empty in strict mode (parse errors propagate). Always empty
   * on healthy runs.
   */
  astParseFailures: AstParseFailureOutcome[];
}

// ─── Constants ──────────────────────────────────────

const COMPILED_RULES_FILE = 'compiled-rules.json';

// ─── Core logic ─────────────────────────────────────

/**
 * Compiled-rules execution engine used by `totem lint`. Loads rules, extracts additions, enriches
 * with AST context, records metrics, and formats output.
 */
export async function runCompiledRules(
  options: RunCompiledRulesOptions,
): Promise<RunCompiledRulesResult> {
  const path = await import('node:path');
  const { bold, errorColor, log, success: successColor } = await import('../ui.js');
  const { writeOutput } = await import('../utils.js');
  const {
    applyAstRulesToAdditions,
    applyRulesToAdditionsBounded,
    enrichWithAstContext,
    extractAddedLines,
    loadCompiledRules,
    loadRuleMetrics,
    matchesGlob,
    recordContextHit,
    recordEvaluation,
    recordSuppression,
    recordTrigger,
    RegexEvaluator,
    resolveGitRoot,
    safeExec,
    sanitizeForTerminal,
    saveRuleMetrics,
    TotemError,
  } = await import('@mmnto/totem');
  type RuleEngineContext = import('@mmnto/totem').RuleEngineContext;

  const {
    diff,
    cwd,
    totemDir,
    format,
    outPath,
    exportPaths,
    ignorePatterns,
    tag,
    isStaged,
    regexTimeoutMode,
    astParseMode,
  } = options;

  // Per-invocation rule-engine context (ADR-071 + mmnto/totem#1441): logger
  // threads into the engine as a parameter rather than a module-level setter,
  // so concurrent / federated runs cannot clobber each other's wiring.
  const ruleCtx: RuleEngineContext = {
    logger: { warn: (msg: string) => log.warn(tag, msg) },
    state: { hasWarnedShieldContext: false },
  };
  const resolvedTotemDir = path.join(options.configRoot ?? cwd, totemDir);

  // Load compiled rules
  const rulesPath = path.join(resolvedTotemDir, COMPILED_RULES_FILE);
  const rules = loadCompiledRules(rulesPath);

  // Empty corpus is a legitimate state for early-adoption / aspirational repos
  // (mmnto-ai/totem#1831). Log + skip rather than throwing so CI does not fail
  // on repos that have a valid lint configuration but no lessons compiled yet.
  // Consumers that need a "rule count > 0" CI guardrail can check
  // `compiled-rules.json` length directly in their pipeline.
  if (rules.length === 0) {
    log.info(
      tag,
      `No compiled rules at ${totemDir}/${COMPILED_RULES_FILE} — skipping (empty-corpus repo). Run 'totem lesson compile' once you have lessons.`,
    );
    return {
      violations: [],
      findings: [],
      rules: [],
      output: '',
      regexTimeouts: [],
      astParseFailures: [],
    };
  }

  log.info(tag, `Running ${rules.length} rules (zero LLM)...`);

  // Extract additions, exclude compiled rules file, export targets, and binary files
  const BINARY_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.mp4',
    '.pdf',
    '.zip',
    '.tar',
    '.gz',
    '.woff',
    '.woff2',
    '.eot',
    '.ttf',
    '.mp3',
    '.wav',
    '.ico',
    '.bin',
  ]);
  const rulesRelPath = path.join(totemDir, COMPILED_RULES_FILE).replace(/\\/g, '/');
  const excluded = new Set([rulesRelPath]);
  if (exportPaths) {
    for (const ep of exportPaths) {
      excluded.add(ep.replace(/\\/g, '/'));
    }
  }
  const additions = extractAddedLines(diff)
    .filter((a) => !excluded.has(a.file))
    .filter((a) => !BINARY_EXTENSIONS.has(path.extname(a.file).toLowerCase()))
    .filter(
      (a) => !ignorePatterns || !ignorePatterns.some((pattern) => matchesGlob(a.file, pattern)),
    );

  // Resolve repo root once — git diff paths are always repo-root-relative,
  // so both staged and non-staged paths need the repo root for file resolution.
  const repoRoot = resolveGitRoot(cwd);

  // Enrich with AST context
  try {
    await enrichWithAstContext(additions, { cwd: repoRoot ?? cwd });
    const classified = additions.filter((a) => a.astContext !== undefined).length;
    if (classified > 0) {
      log.dim(tag, `AST classified ${classified}/${additions.length} additions`);
    }
    // totem-context: intentional graceful degradation — AST enrichment is best-effort
  } catch {
    log.dim(tag, 'AST classification unavailable, falling back to raw matching');
  }

  // Record metrics + Trap Ledger
  const { appendLedgerEvent } = await import('@mmnto/totem');
  const metrics = loadRuleMetrics(resolvedTotemDir, (msg) => log.dim(tag, msg));
  const ruleEventCallback: RuleEventCallback = (event, hash, context) => {
    if (event === 'trigger') {
      recordTrigger(metrics, hash);
      recordContextHit(metrics, hash, context?.astContext);
    } else if (event === 'suppress') {
      recordSuppression(metrics, hash);
      // Append to Trap Ledger (fire-and-forget). When the suppressed rule
      // was shipped by a pack with immutable: true (ADR-089,
      // mmnto-ai/totem#1485), the event carries the flag so auditors can
      // surface every attempt to silence an enforced security rule via
      // `jq 'select(.immutable == true)'` over events.ndjson.
      if (context) {
        appendLedgerEvent(
          resolvedTotemDir,
          {
            timestamp: new Date().toISOString(),
            type: context.justification ? 'override' : 'suppress',
            ruleId: hash,
            file: context.file,
            line: context.line,
            justification: context.justification ?? '',
            source: 'lint',
            ...(context.immutable === true ? { immutable: true } : {}),
          },
          (msg) => log.dim(tag, msg),
        );
      }
    } else {
      // mmnto/totem#1408: 'failure' event fires when a compiled rule's
      // runtime findAll throws (per-rule try/catch in executeQuery). Log
      // the hash and reason so the operator can see WHICH rule failed
      // without crashing the batch. Metric recording (recordFailure) is
      // a follow-up once `rule-metrics` gains a failure counter.
      log.warn(
        tag,
        `rule ${hash} failed at runtime${context?.failureReason ? `: ${context.failureReason}` : ''}`,
      );
    }
  };
  // mmnto-ai/totem#1641: bounded regex evaluation with per-rule-per-file
  // timeout. Strict (default) surfaces timeouts as lint errors; lenient
  // skips the timing-out rule-file pair with a warning. Evaluator spawns
  // a single persistent worker for the whole lint run and disposes at
  // the end of this function. Telemetry records are appended to the
  // existing `.totem/temp/telemetry.jsonl` sink tagged `type: 'regex-execution'`
  // so downstream tooling can filter regex metrics from LLM metrics.
  const effectiveTimeoutMode: TimeoutMode = regexTimeoutMode ?? 'strict';
  const fs = await import('node:fs');
  const writeRegexTelemetry = (record: import('@mmnto/totem').RegexTelemetry): void => {
    try {
      // Use `resolvedTotemDir` (which respects `configRoot`) rather than
      // `cwd` so telemetry lands next to compile-manifest.json when the
      // caller runs lint from a sub-directory (CR PR #1644 round-1).
      const tempDir = path.join(resolvedTotemDir, 'temp');
      fs.mkdirSync(tempDir, { recursive: true });
      const entry = {
        type: 'regex-execution' as const,
        timestamp: new Date().toISOString(),
        ...record,
      };
      fs.appendFileSync(
        path.join(tempDir, 'telemetry.jsonl'),
        JSON.stringify(entry) + '\n',
        'utf-8',
      ); // totem-context: intentional best-effort telemetry sink — failures are surfaced via log.warn below rather than rethrown so disk-full or permission errors on the telemetry path do not break lint.
    } catch (err) {
      log.warn(
        tag,
        `Failed to write regex telemetry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const regexEvaluator = new RegexEvaluator({}, writeRegexTelemetry);
  let regexViolations: Violation[] = [];
  const regexTimeouts: RuleTimeoutOutcome[] = [];
  try {
    const bounded = await applyRulesToAdditionsBounded(
      ruleCtx,
      rules,
      additions,
      {
        evaluator: regexEvaluator,
        timeoutMode: effectiveTimeoutMode,
        repoRoot: repoRoot ?? cwd,
      },
      ruleEventCallback,
    );
    regexViolations = bounded.violations;
    regexTimeouts.push(...bounded.timeoutOutcomes);
    for (const timeout of bounded.timeoutOutcomes) {
      const modeLabel = timeout.mode === 'strict' ? 'error' : 'skipped';
      log.warn(
        tag,
        `rule ${timeout.ruleHash} timed out after ${timeout.elapsedMs}ms on ${timeout.file} (${modeLabel})`,
      );
    }
  } finally {
    await regexEvaluator.dispose();
  }

  // Run AST rules (async — reads files and runs Tree-sitter/ast-grep queries)
  const astRules = rules.filter((r) => r.engine === 'ast' || r.engine === 'ast-grep');
  let astViolations: Violation[] = [];
  const astParseFailures: AstParseFailureOutcome[] = [];
  // mmnto-ai/totem#1982. Resolve effective mode with env override (matches
  // the operator escape pattern: CLI flag > env var > default 'strict').
  const effectiveAstParseMode: TimeoutMode =
    astParseMode ??
    // totem-context: reading Node's process.env (cleaned by the runtime), not parsing a custom .env file; CRLF/quote-stripping rule doesn't apply.
    (process.env['TOTEM_LINT_AST_PARSE_MODE'] === 'lenient' ? 'lenient' : 'strict');
  if (astRules.length > 0) {
    log.dim(tag, `Running ${astRules.length} AST rule(s)...`);
    try {
      const workingDirectory = repoRoot ?? cwd;
      let readStrategy: ((filePath: string) => Promise<string | null>) | undefined = undefined;

      if (isStaged) {
        if (repoRoot) {
          readStrategy = async (filePath: string) => {
            try {
              // totem-context: false positive — comment mentions `git ls-files`; the actual call below already uses --recurse-submodules
              // 1. Detect symlinks explicitly (git ls-files -s returns mode 120000).
              //    The `--` separator prevents filePath values starting with `-` from
              //    being interpreted as git options.
              const lsOutput = safeExec(
                'git',
                ['ls-files', '--recurse-submodules', '-s', '--', filePath],
                { cwd: repoRoot, env: { ...process.env, LC_ALL: 'C' } },
              );
              if (lsOutput.startsWith('120000 ')) {
                return null; // Explicitly exclude symlinks from AST checks
              }

              // 2. Read staged content
              const content = safeExec('git', ['show', `:${filePath}`], {
                cwd: repoRoot,
                trim: false,
                env: { ...process.env, LC_ALL: 'C' },
              });

              // 3. Normalize CRLF to LF specifically for the staged callback
              // totem-context: Invariant #4 refers to an internal invariant number, not an issue ref
              // Disk-read callback preserves existing behavior per Invariant #4.
              return content.replace(/\r\n/g, '\n');
            } catch (err) {
              // Explicit throw per Failure Mode 1 decision
              throw new TotemError(
                'STAGED_READ_FAILED',
                `Failed to read staged content for ${filePath}`,
                `git show :${filePath} failed. The file may not exist in the index or may be staged for deletion. Ensure --staged is used correctly.`,
                { cause: err },
              );
            }
          };
        }
      }

      astViolations = await applyAstRulesToAdditions(
        ruleCtx,
        rules,
        additions,
        workingDirectory,
        ruleEventCallback,
        (msg) => log.warn(tag, msg),
        readStrategy,
      );
    } catch (err) {
      // STAGED_READ_FAILED must propagate — the pre-commit guarantee depends
      // on surfacing staged-read failures rather than silently falling back.
      if (err instanceof TotemError && err.code === 'STAGED_READ_FAILED') {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmFailure = /not initialized|wasm|web-tree-sitter/i.test(msg);
      const isParseError = err instanceof TotemError && err.code === 'PARSE_FAILED';
      if (process.env['TOTEM_LITE'] === '1' && isWasmFailure) {
        // In the lite binary, WASM init may fail under Node.js (works in Bun).
        // Degrade gracefully: skip AST rules, warn, continue with regex results.
        log.warn(tag, `AST rules skipped (WASM engine unavailable): ${msg}`);
      } else if (isParseError && effectiveAstParseMode === 'lenient') {
        // mmnto-ai/totem#1982: operator escape hatch. AST parse failures
        // (e.g. ast-grep native parser refusing an unsupported language on
        // Windows) escape the per-file loop in core. In lenient mode, treat
        // as a run-wide skip — log a warning, record an outcome, and let
        // regex results stand. The proper per-file degrade lives in
        // mmnto-ai/totem#1786; this is the gap-bridge.
        //
        // Sanitize parser-error text via the canonical sanitizeForTerminal
        // (packages/core/src/terminal-sanitize.ts). ast-grep surfaces
        // snippets of parsed content/paths which may contain terminal
        // control bytes (CSI sequences, bare CR for cursor-rewind spoofing,
        // C0/C1 controls). Defends per CR mmnto-ai/totem#1739 R3.
        const safeMsg = sanitizeForTerminal(msg);
        // matchAll used to satisfy a CodeRabbit security rule that prefers
        // exhaustive iteration over single-match extraction; we still only
        // need the first language token for the outcome shape.
        const languageMatches = [...safeMsg.matchAll(/(\w+) is not supported in napi/gi)];
        astParseFailures.push({
          file: '*', // run-wide: catch is outside the per-file loop in core
          language: languageMatches[0] ? languageMatches[0][1]! : 'unknown',
          message: safeMsg.slice(0, 200),
          mode: 'lenient',
        });
        log.warn(
          tag,
          `AST rules skipped (--ast-parse-mode lenient, ${astParseFailures[0]!.language}): ${safeMsg}`,
        );
      } else {
        throw err;
      }
    }
  }

  const violations = [...regexViolations, ...astViolations];

  // ── Zero-match rule detection (mmnto-ai/totem#1061) ────────────
  // Count rules whose fileGlobs matched none of the files in this diff.
  const diffFiles = [...new Set(additions.map((a) => a.file))];
  const zeroMatchRules: CompiledRule[] = [];
  for (const rule of rules) {
    if (rule.fileGlobs && rule.fileGlobs.length > 0) {
      const positive = rule.fileGlobs.filter((g) => typeof g === 'string' && !g.startsWith('!'));
      const negative = rule.fileGlobs
        .filter((g): g is string => typeof g === 'string' && g.startsWith('!'))
        .map((g) => g.slice(1));
      const hasMatch = diffFiles.some((file) => {
        const positiveMatch = positive.length === 0 || positive.some((g) => matchesGlob(file, g));
        const negativeMatch = negative.some((g) => matchesGlob(file, g));
        return positiveMatch && !negativeMatch;
      });
      if (!hasMatch) zeroMatchRules.push(rule);
    }
  }
  if (zeroMatchRules.length > 0) {
    log.dim(tag, `${zeroMatchRules.length} rule(s) matched no files in this diff`);
  }

  // mmnto-ai/totem#1483: tick evaluationCount once per rule per lint run.
  // Invariant: one run loads the rule set, evaluates each rule against the
  // diff additions, and increments the counter here exactly once per
  // lessonHash. Multiple matches on a rule within one run still produce a
  // single increment. This counter is the "was this rule exercised" signal
  // the doctor stale-rule check reads to distinguish a dormant rule from a
  // rule that has genuinely sat through N lint cycles without firing.
  for (const rule of rules) {
    recordEvaluation(metrics, rule.lessonHash);
  }

  try {
    saveRuleMetrics(resolvedTotemDir, metrics);
    // totem-context: intentional graceful degradation — metric save is best-effort
  } catch (err) {
    log.warn(
      tag,
      `Could not save rule metrics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Classify violations into blocking (exit-1) vs advisory (printed, non-blocking).
  // Computed once, reused across all output formats.
  //
  // mmnto-ai/totem#2181 — engine-type advisory split. `totem lint` runs only
  // .totem/compiled-rules.json, and every rule there is a frozen compiled lesson
  // (un-recompilable under the standing rule-compilation freeze). The regex engine
  // is the false-positive flood that forced `--no-verify` on every #2179 push; the
  // ast/ast-grep family is the structural/precision class that earns hard
  // enforcement. Demote the whole regex class to advisory — printed, excluded from
  // the exit-1 tally — REGARDLESS of severity (one discriminator: engine, not
  // engine×severity; Tenet 21). Hard engines keep their existing severity behavior
  // (error blocks, warning doesn't) — that is "stay hard".
  //
  // `isHardEngine` is the single source of truth for "blocks". Only an explicit
  // ast/ast-grep engine is hard; a regex engine OR a legacy rule with no `engine`
  // field falls to advisory — matching rule-engine.ts's `r.engine === 'regex' ||
  // !r.engine` convention, where a missing engine is treated AS regex (gemini /
  // greptile #2182). The durable provenance/ruleClass marker rides the spine
  // (mmnto-ai/totem-strategy#516); engine-type is the conservative interim proxy.
  const isHardEngine = (v: Violation): boolean =>
    v.rule.engine === 'ast' || v.rule.engine === 'ast-grep';
  const isBlocking = (v: Violation): boolean =>
    isHardEngine(v) && (v.rule.severity ?? 'error') === 'error';
  const errors = violations.filter(isBlocking);
  const warnings = violations.filter((v) => !isBlocking(v));
  // Whether any non-blocking finding is a frozen-lesson regex-class rule (regex, or a
  // legacy rule with no engine) vs only ast/ast-grep probationary warnings. Gates the
  // frozen-lesson wording in BOTH the text note and the SARIF summary, so an
  // ast-warning-only run is never mislabeled as frozen-lesson (gemini/greptile #2182).
  const hasFrozenLessonAdvisory = warnings.some((v) => !isHardEngine(v));

  // Convert to unified findings model once (ADR-071)
  const { violationToFinding } = await import('@mmnto/totem');
  const findings = violations.map(violationToFinding);

  // Build output
  let output: string;

  if (format === 'sarif') {
    const { buildSarifLog, getHeadSha } = await import('@mmnto/totem');
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const version = (req('../../package.json') as { version: string }).version;
    const commitHash = getHeadSha(cwd) ?? undefined;
    // SARIF results carry only BLOCKING findings (ast/ast-grep error-severity).
    // The non-blocking set — frozen-lesson regex rules (any severity, demoted to
    // advisory under mmnto-ai/totem#2181) plus probationary warning-severity rules
    // — is omitted from the per-finding annotations and surfaced as a single
    // summary note, to avoid alert fatigue in the PR UI (Proposal 190).
    const sarif = buildSarifLog(errors, rules, { version, commitHash });

    // Surface the non-blocking (advisory) count as a single note so users know they exist
    if (warnings.length > 0) {
      const summaryRuleIdx = sarif.runs[0].tool.driver.rules.length;
      sarif.runs[0].tool.driver.rules.push({
        id: 'totem/warning-summary',
        shortDescription: {
          text: 'Advisory (non-blocking) findings detected — run `totem lint` locally to review',
        },
      });
      sarif.runs[0].results.push({
        ruleId: 'totem/warning-summary',
        ruleIndex: summaryRuleIdx,
        level: 'note',
        message: {
          // Conditionalize the frozen-lesson mention exactly like the text note
          // (greptile #2182): an ast/ast-grep-warning-only run has no regex-class
          // advisory, so it must not claim frozen-lesson regex rules.
          text: `${warnings.length} advisory (non-blocking) finding(s) detected${
            hasFrozenLessonAdvisory
              ? ' (incl. frozen-lesson regex rules demoted under mmnto-ai/totem#2181)'
              : ''
          } — excluded from PR annotations. Run \`totem lint\` locally to review.`,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: '.totem/compiled-rules.json' },
              region: { startLine: 1 },
            },
          },
        ],
      });
    }

    output = JSON.stringify(sarif, null, 2);
  } else if (format === 'json') {
    output = JSON.stringify(
      {
        pass: errors.length === 0,
        rules: rules.length,
        errors: errors.length,
        warnings: warnings.length,
        findings,
        violations,
      },
      null,
      2,
    );
  } else {
    const lines: string[] = [];

    if (errors.length === 0 && warnings.length === 0) {
      // Clean pass — only emit verbose markdown when writing to file
      if (outPath) {
        lines.push('### Verdict');
        lines.push(`**PASS** - All ${rules.length} rules passed.`);
        lines.push('');
        lines.push('### Details');
        lines.push('No violations detected against compiled rules.');
      }
    } else {
      lines.push('### Verdict');
      if (errors.length > 0) {
        lines.push(
          `**FAIL** - ${errors.length} error(s)${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''} across ${rules.length} rules.`,
        );
      } else {
        lines.push(
          `**PASS** - ${warnings.length} warning(s), 0 errors across ${rules.length} rules.`,
        );
      }

      if (errors.length > 0) {
        lines.push('');
        lines.push('### Errors');
        for (const v of errors) {
          lines.push(`- **${v.file}:${v.lineNumber}** - ${v.rule.message}`);
          lines.push(`  Pattern: \`/${v.rule.pattern}/\``);
          lines.push(`  Lesson: "${v.rule.lessonHeading}"`);
          lines.push(`  Line: \`${v.line.trim()}\``);
          lines.push('');
        }
      }

      if (warnings.length > 0) {
        lines.push('');
        lines.push('### Warnings');
        // mmnto-ai/totem#2181: the frozen-lesson advisory note applies only to the
        // regex-class (regex, or legacy no-engine). ast/ast-grep severity:warning
        // findings also land in `warnings` (genuine Rule-Nursery probationary
        // warnings) — emit the note only when a regex-class advisory is actually
        // present, else a regex-free warning list is mislabeled (gemini #2182).
        if (hasFrozenLessonAdvisory) {
          lines.push(
            '_Advisory — printed for awareness, excluded from the exit code. Frozen-lesson (regex) rules are sensed-not-enforced under the rule-compilation freeze (mmnto-ai/totem#2181); PR review is the real sensor._',
          );
        }
        for (const v of warnings) {
          lines.push(`- **${v.file}:${v.lineNumber}** - ${v.rule.message}`);
          lines.push(`  Pattern: \`/${v.rule.pattern}/\``);
          lines.push(`  Lesson: "${v.rule.lessonHeading}"`);
          lines.push(`  Line: \`${v.line.trim()}\``);
          lines.push('');
        }
      }
    }
    output = lines.join('\n');
  }

  writeOutput(output, outPath);
  if (outPath) log.success(tag, `Written to ${outPath}`);

  if (errors.length > 0) {
    const verdictLabel = errorColor(bold('FAIL'));
    const warnSuffix = warnings.length > 0 ? `, ${warnings.length} warning(s)` : '';
    log.info(tag, `Verdict: ${verdictLabel} - ${errors.length} error(s)${warnSuffix}`);
    throw new TotemError(
      'SHIELD_FAILED',
      'Violations detected',
      'Fix the violations above or use totem explain <hash> for details.',
    );
  } else if (warnings.length > 0) {
    const verdictLabel = successColor(bold('PASS'));
    log.info(tag, `Verdict: ${verdictLabel} - ${warnings.length} warning(s), 0 errors`);
  } else {
    const verdictLabel = successColor(bold('PASS'));
    log.info(tag, `Verdict: ${verdictLabel} - ${rules.length} rules, 0 violations`);
  }

  return { violations, findings, rules, output, regexTimeouts, astParseFailures };
}
