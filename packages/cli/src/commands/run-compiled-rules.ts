import type { CompiledRule, RuleEventCallback, TotemFinding, Violation } from '@mmnto/totem';

import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

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
}

export interface RunCompiledRulesResult {
  violations: Violation[];
  /** Unified findings (ADR-071) — same data as violations, normalized shape */
  findings: TotemFinding[];
  rules: CompiledRule[];
  output: string;
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
    applyRulesToAdditions,
    enrichWithAstContext,
    extractAddedLines,
    loadCompiledRules,
    loadRuleMetrics,
    matchesGlob,
    recordContextHit,
    recordSuppression,
    recordTrigger,
    resolveGitRoot,
    safeExec,
    saveRuleMetrics,
    setCoreLogger,
    TotemError,
  } = await import('@mmnto/totem');

  const { diff, cwd, totemDir, format, outPath, exportPaths, ignorePatterns, tag, isStaged } =
    options;

  // Wire core logger to CLI UI (ADR-071: core must not use console.warn directly)
  setCoreLogger({ warn: (msg) => log.warn(tag, msg) });
  try {
    const resolvedTotemDir = path.join(options.configRoot ?? cwd, totemDir);

    // Load compiled rules
    const rulesPath = path.join(resolvedTotemDir, COMPILED_RULES_FILE);
    const rules = loadCompiledRules(rulesPath);

    if (rules.length === 0) {
      throw new TotemError(
        'NO_RULES',
        `No compiled rules found at ${totemDir}/${COMPILED_RULES_FILE}.`,
        "Run 'totem compile' to generate rules.",
      );
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
        // Append to Trap Ledger (fire-and-forget)
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
    const regexViolations = applyRulesToAdditions(rules, additions, ruleEventCallback);

    // Run AST rules (async — reads files and runs Tree-sitter/ast-grep queries)
    const astRules = rules.filter((r) => r.engine === 'ast' || r.engine === 'ast-grep');
    let astViolations: Violation[] = [];
    if (astRules.length > 0) {
      log.dim(tag, `Running ${astRules.length} AST rule(s)...`);
      try {
        const workingDirectory = repoRoot ?? cwd;
        let readStrategy: ((filePath: string) => Promise<string | null>) | undefined = undefined;

        if (isStaged) {
          if (repoRoot) {
            readStrategy = async (filePath: string) => {
              try {
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
        if (process.env['TOTEM_LITE'] === '1' && isWasmFailure) {
          // In the lite binary, WASM init may fail under Node.js (works in Bun).
          // Degrade gracefully: skip AST rules, warn, continue with regex results.
          log.warn(tag, `AST rules skipped (WASM engine unavailable): ${msg}`);
        } else {
          throw err;
        }
      }
    }

    const violations = [...regexViolations, ...astViolations];

    // ── Zero-match rule detection (#1061) ────────────
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

    try {
      saveRuleMetrics(resolvedTotemDir, metrics);
    } catch (err) {
      log.warn(
        tag,
        `Could not save rule metrics: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Classify violations by severity (computed once, reused across all output formats)
    const errors = violations.filter((v) => (v.rule.severity ?? 'error') === 'error');
    const warnings = violations.filter((v) => (v.rule.severity ?? 'error') === 'warning');

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
      // SARIF is a strict channel for error-severity findings only.
      // Warnings are probationary (Rule Nursery) and stay as local telemetry
      // to prevent alert fatigue in the PR UI (Proposal 190).
      const sarif = buildSarifLog(errors, rules, { version, commitHash });

      // Surface warning count as a single note so users know they exist
      if (warnings.length > 0) {
        const summaryRuleIdx = sarif.runs[0].tool.driver.rules.length;
        sarif.runs[0].tool.driver.rules.push({
          id: 'totem/warning-summary',
          shortDescription: {
            text: 'Probationary warnings detected — run `totem lint` locally to review',
          },
        });
        sarif.runs[0].results.push({
          ruleId: 'totem/warning-summary',
          ruleIndex: summaryRuleIdx,
          level: 'note',
          message: {
            text: `${warnings.length} warning-severity finding(s) detected. Warnings are probationary and not shown in PR reviews. Run \`totem lint\` locally to review.`,
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

    return { violations, findings, rules, output };
  } finally {
    setCoreLogger({ warn: () => {} });
  }
}
