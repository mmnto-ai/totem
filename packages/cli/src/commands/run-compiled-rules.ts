import type { CompiledRule, Violation } from '@mmnto/totem';

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
}

export interface RunCompiledRulesResult {
  violations: Violation[];
  rules: CompiledRule[];
  output: string;
}

// ─── Constants ──────────────────────────────────────

const COMPILED_RULES_FILE = 'compiled-rules.json';

// ─── Core logic ─────────────────────────────────────

/**
 * Shared compiled-rules execution engine used by both `totem lint` and
 * `totem shield --deterministic`. Loads rules, extracts additions, enriches
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
    recordSuppression,
    recordTrigger,
    saveRuleMetrics,
    TotemError,
  } = await import('@mmnto/totem');

  const { diff, cwd, totemDir, format, outPath, exportPaths, ignorePatterns, tag } = options;

  // Load compiled rules
  const rulesPath = path.join(cwd, totemDir, COMPILED_RULES_FILE);
  const rules = loadCompiledRules(rulesPath);

  if (rules.length === 0) {
    throw new TotemError(
      'NO_RULES',
      `No compiled rules found at ${totemDir}/${COMPILED_RULES_FILE}.`,
      "Run 'totem compile' to generate rules.",
    );
  }

  log.info(tag, `Running ${rules.length} rules (zero LLM)...`);

  // Extract additions, exclude compiled rules file and export targets
  const rulesRelPath = path.join(totemDir, COMPILED_RULES_FILE).replace(/\\/g, '/');
  const excluded = new Set([rulesRelPath]);
  if (exportPaths) {
    for (const ep of exportPaths) {
      excluded.add(ep.replace(/\\/g, '/'));
    }
  }
  const additions = extractAddedLines(diff)
    .filter((a) => !excluded.has(a.file))
    .filter(
      (a) => !ignorePatterns || !ignorePatterns.some((pattern) => matchesGlob(a.file, pattern)),
    );

  // Enrich with AST context
  try {
    await enrichWithAstContext(additions, { cwd });
    const classified = additions.filter((a) => a.astContext !== undefined).length;
    if (classified > 0) {
      log.dim(tag, `AST classified ${classified}/${additions.length} additions`);
    }
  } catch {
    log.dim(tag, 'AST classification unavailable, falling back to raw matching');
  }

  // Record metrics
  const metrics = loadRuleMetrics(totemDir, (msg) => log.dim(tag, msg));
  const ruleEventCallback = (event: 'trigger' | 'suppress', hash: string) => {
    if (event === 'trigger') recordTrigger(metrics, hash);
    else recordSuppression(metrics, hash);
  };
  const regexViolations = applyRulesToAdditions(rules, additions, ruleEventCallback);

  // Run AST rules (async — reads files and runs Tree-sitter/ast-grep queries)
  const astRules = rules.filter((r) => r.engine === 'ast' || r.engine === 'ast-grep');
  let astViolations: Violation[] = [];
  if (astRules.length > 0) {
    log.dim(tag, `Running ${astRules.length} AST rule(s)...`);
    astViolations = await applyAstRulesToAdditions(rules, additions, cwd, ruleEventCallback);
  }

  const violations = [...regexViolations, ...astViolations];

  try {
    saveRuleMetrics(totemDir, metrics);
  } catch (err) {
    log.warn(
      tag,
      `Could not save rule metrics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Classify violations by severity (computed once, reused across all output formats)
  const errors = violations.filter((v) => (v.rule.severity ?? 'error') === 'error');
  const warnings = violations.filter((v) => (v.rule.severity ?? 'error') === 'warning');

  // Build output
  let output: string;

  if (format === 'sarif') {
    const { buildSarifLog, getHeadSha } = await import('@mmnto/totem');
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const version = (req('../../package.json') as { version: string }).version;
    const commitHash = getHeadSha(cwd) ?? undefined;
    const sarif = buildSarifLog(violations, rules, { version, commitHash });
    output = JSON.stringify(sarif, null, 2);
  } else if (format === 'json') {
    output = JSON.stringify(
      {
        pass: errors.length === 0,
        rules: rules.length,
        errors: errors.length,
        warnings: warnings.length,
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
        lines.push(`**PASS** — All ${rules.length} rules passed.`);
        lines.push('');
        lines.push('### Details');
        lines.push('No violations detected against compiled rules.');
      }
    } else {
      lines.push('### Verdict');
      if (errors.length > 0) {
        lines.push(
          `**FAIL** — ${errors.length} error(s)${warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''} across ${rules.length} rules.`,
        );
      } else {
        lines.push(
          `**PASS** — ${warnings.length} warning(s), 0 errors across ${rules.length} rules.`,
        );
      }

      if (errors.length > 0) {
        lines.push('');
        lines.push('### Errors');
        for (const v of errors) {
          lines.push(`- **${v.file}:${v.lineNumber}** — ${v.rule.message}`);
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
          lines.push(`- **${v.file}:${v.lineNumber}** — ${v.rule.message}`);
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
    log.info(tag, `Verdict: ${verdictLabel} — ${errors.length} error(s)${warnSuffix}`);
    throw new TotemError(
      'SHIELD_FAILED',
      'Violations detected',
      'Fix the violations above or use totem explain <hash> for details.',
    );
  } else if (warnings.length > 0) {
    const verdictLabel = successColor(bold('PASS'));
    log.info(tag, `Verdict: ${verdictLabel} — ${warnings.length} warning(s), 0 errors`);
  } else {
    const verdictLabel = successColor(bold('PASS'));
    log.info(tag, `Verdict: ${verdictLabel} — ${rules.length} rules, 0 violations`);
  }

  return { violations, rules, output };
}
