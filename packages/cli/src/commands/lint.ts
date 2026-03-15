import type { ShieldFormat } from './shield.js';

// ─── Constants ──────────────────────────────────────

const TAG = 'Lint';
const COMPILED_RULES_FILE = 'compiled-rules.json';

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
}

// ─── Command ────────────────────────────────────────

export async function lintCommand(options: LintOptions): Promise<void> {
  const path = await import('node:path');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  const { extractChangedFiles, getDefaultBranch, getGitBranchDiff, getGitDiff } =
    await import('../git.js');
  const { bold, errorColor, log, success: successColor } = await import('../ui.js');
  const {
    applyRulesToAdditions,
    enrichWithAstContext,
    extractAddedLines,
    loadCompiledRules,
    matchesGlob,
  } = await import('@mmnto/totem');

  const format: ShieldFormat = options.format ?? 'text';
  const VALID_FORMATS: ShieldFormat[] = ['text', 'sarif', 'json'];
  if (!VALID_FORMATS.includes(format)) {
    throw new Error(`[Totem Error] Invalid --format "${format}". Use "text", "sarif", or "json".`);
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff
  const mode = options.staged ? 'staged' : 'all';
  log.info(TAG, `Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  let diff = getGitDiff(mode, cwd);

  if (!diff.trim()) {
    const base = getDefaultBranch(cwd);
    log.dim(TAG, `No uncommitted changes. Falling back to branch diff (${base}...HEAD)...`);
    diff = getGitBranchDiff(cwd, base);
  }

  if (!diff.trim()) {
    log.warn(TAG, 'No changes detected. Nothing to lint.');
    return;
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(TAG, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  // Load compiled rules
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, COMPILED_RULES_FILE);
  const rules = loadCompiledRules(rulesPath);

  if (rules.length === 0) {
    log.error(
      'Totem Error',
      `No compiled rules found at ${config.totemDir}/${COMPILED_RULES_FILE}. Run \`totem compile\` first.`,
    );
    process.exit(1);
  }

  log.info(TAG, `Running ${rules.length} rules (zero LLM)...`);

  // Extract additions, exclude compiled rules file and export targets
  const rulesRelPath = path.join(config.totemDir, COMPILED_RULES_FILE).replace(/\\/g, '/');
  const excluded = new Set([rulesRelPath]);
  const exportPaths = config.exports ? Object.values(config.exports) : [];
  for (const ep of exportPaths) {
    excluded.add(ep.replace(/\\/g, '/'));
  }
  const ignorePatterns = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const additions = extractAddedLines(diff)
    .filter((a) => !excluded.has(a.file))
    .filter((a) => !ignorePatterns.some((pattern) => matchesGlob(a.file, pattern)));

  // Enrich with AST context
  try {
    await enrichWithAstContext(additions, { cwd });
    const classified = additions.filter((a) => a.astContext !== undefined).length;
    if (classified > 0) {
      log.dim(TAG, `AST classified ${classified}/${additions.length} additions`);
    }
  } catch {
    log.dim(TAG, 'AST classification unavailable, falling back to raw matching');
  }

  // Record metrics
  const { loadRuleMetrics, recordTrigger, recordSuppression, saveRuleMetrics } =
    await import('@mmnto/totem');
  const metrics = loadRuleMetrics(totemDir, (msg) => log.dim(TAG, msg));
  const violations = applyRulesToAdditions(rules, additions, (event, hash) => {
    if (event === 'trigger') recordTrigger(metrics, hash);
    else recordSuppression(metrics, hash);
  });
  try {
    saveRuleMetrics(totemDir, metrics);
  } catch (err) {
    log.warn(
      TAG,
      `Could not save rule metrics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Build output
  const { writeOutput } = await import('../utils.js');
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
      { pass: violations.length === 0, rules: rules.length, violations },
      null,
      2,
    );
  } else {
    const lines: string[] = [];
    if (violations.length === 0) {
      lines.push('### Verdict');
      lines.push(`**PASS** — All ${rules.length} rules passed.`);
      lines.push('');
      lines.push('### Details');
      lines.push('No violations detected against compiled rules.');
    } else {
      lines.push('### Verdict');
      lines.push(
        `**FAIL** — ${violations.length} violation(s) found across ${rules.length} rules.`,
      );
      lines.push('');
      lines.push('### Violations');
      for (const v of violations) {
        lines.push(`- **${v.file}:${v.lineNumber}** — ${v.rule.message}`);
        lines.push(`  Pattern: \`/${v.rule.pattern}/\``);
        lines.push(`  Lesson: "${v.rule.lessonHeading}"`);
        lines.push(`  Line: \`${v.line.trim()}\``);
        lines.push('');
      }
    }
    output = lines.join('\n');
  }

  writeOutput(output, options.out);
  if (options.out) log.success(TAG, `Written to ${options.out}`);

  if (violations.length > 0) {
    const verdictLabel = errorColor(bold('FAIL'));
    log.info(TAG, `Verdict: ${verdictLabel} — ${violations.length} violation(s)`);
    process.exit(1);
  } else {
    const verdictLabel = successColor(bold('PASS'));
    log.info(TAG, `Verdict: ${verdictLabel} — ${rules.length} rules, 0 violations`);
  }
}
