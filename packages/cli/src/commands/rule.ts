import type { CompiledRule } from '@mmnto/totem';

const TAG = 'Rule';

// ─── Helpers ───────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

/**
 * Resolve the rules path and load rules, with a user-friendly error
 * when no compiled-rules.json exists.
 */
async function loadRulesOrExit(): Promise<{
  rules: CompiledRule[];
  totemDir: string;
  cwd: string;
}> {
  const path = await import('node:path');
  const { loadCompiledRules } = await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, 'compiled-rules.json');

  const rules = loadCompiledRules(rulesPath);

  return { rules, totemDir, cwd };
}

/**
 * Find rules matching a hash prefix. Returns the match(es) and handles
 * ambiguous / not-found cases with user output.
 */
function resolveRuleByPrefix(
  rules: CompiledRule[],
  id: string,
  log: (typeof import('../ui.js'))['log'],
  bold: (typeof import('../ui.js'))['bold'],
): CompiledRule | null {
  const lower = id.toLowerCase();
  const matches = rules.filter((r) => r.lessonHash.toLowerCase().startsWith(lower));

  if (matches.length === 0) {
    log.error('Totem Error', `No rule found matching '${id}'`);
    return null;
  }

  if (matches.length > 1) {
    log.warn(TAG, `Ambiguous prefix '${id}' matches ${matches.length} rules:`);
    for (const m of matches) {
      log.info(TAG, `  ${bold(m.lessonHash)} \u2014 ${m.lessonHeading}`);
    }
    log.dim(TAG, 'Provide more characters to disambiguate.');
    return null;
  }

  return matches[0]!;
}

// ─── Subcommands ───────────────────────────────────────

export async function ruleListCommand(): Promise<void> {
  const { log, dim, bold } = await import('../ui.js');
  const { rules } = await loadRulesOrExit();

  // JSON mode — output structured data and return
  const { isJsonMode, printJson } = await import('../json-output.js');
  if (isJsonMode()) {
    printJson({
      status: 'success',
      command: 'rule list',
      data: {
        rules: rules.map((r) => ({
          hash: r.lessonHash,
          heading: r.lessonHeading,
          engine: r.engine,
          severity: r.severity,
          fileGlobs: r.fileGlobs,
        })),
      },
    });
    return;
  }

  if (rules.length === 0) {
    log.error('Totem Error', 'No compiled rules found. Run `totem compile` first.');
    return;
  }

  // Table header
  const hashW = 10;
  const engineW = 10;
  const sevW = 9;
  const globW = 7;
  const headingW = 50;

  console.error(
    dim(
      `  ${'HASH'.padEnd(hashW)}${'ENGINE'.padEnd(engineW)}${'SEVERITY'.padEnd(sevW)}${'GLOBS'.padEnd(globW)}HEADING`,
    ),
  );
  console.error(dim('  ' + '\u2500'.repeat(hashW + engineW + sevW + globW + headingW)));

  for (const rule of rules) {
    const hash = rule.lessonHash.slice(0, 8).padEnd(hashW);
    const engine = (rule.engine ?? 'regex').padEnd(engineW);
    const severity = (rule.severity ?? 'warning').padEnd(sevW);
    const globs = String(rule.fileGlobs?.length ?? 0).padEnd(globW);
    const heading = truncate(rule.lessonHeading, headingW);

    console.error(`  ${hash}${engine}${severity}${globs}${heading}`);
  }

  console.error('');
  log.info(TAG, `${bold(String(rules.length))} rule(s) total`);
}

export async function ruleInspectCommand(id: string): Promise<void> {
  const { log, bold, dim } = await import('../ui.js');
  const { rules } = await loadRulesOrExit();

  if (rules.length === 0) {
    log.error('Totem Error', 'No compiled rules found. Run `totem compile` first.');
    return;
  }

  const rule = resolveRuleByPrefix(rules, id, log, bold);
  if (!rule) return;

  console.error('');
  log.info(TAG, `${bold('Hash:')}       ${rule.lessonHash}`);
  log.info(TAG, `${bold('Heading:')}    ${rule.lessonHeading}`);
  log.info(TAG, `${bold('Engine:')}     ${rule.engine}`);
  log.info(TAG, `${bold('Severity:')}   ${rule.severity ?? 'warning'}`);
  log.info(TAG, `${bold('Message:')}    ${rule.message}`);

  if (rule.pattern) {
    log.info(TAG, `${bold('Pattern:')}    ${dim(rule.pattern)}`);
  }
  if (rule.astQuery) {
    log.info(TAG, `${bold('AST Query:')}  ${dim(rule.astQuery)}`);
  }
  if (rule.astGrepPattern) {
    const display =
      typeof rule.astGrepPattern === 'string'
        ? rule.astGrepPattern
        : JSON.stringify(rule.astGrepPattern);
    log.info(TAG, `${bold('AST Grep:')}   ${dim(display)}`);
  }
  if (rule.fileGlobs && rule.fileGlobs.length > 0) {
    log.info(TAG, `${bold('File Globs:')} ${rule.fileGlobs.join(', ')}`);
  }
  if (rule.compiledAt) {
    log.info(TAG, `${bold('Compiled:')}   ${rule.compiledAt}`);
  }
  if (rule.createdAt) {
    log.info(TAG, `${bold('Created:')}    ${rule.createdAt}`);
  }
  console.error('');
}

export async function ruleTestCommand(id: string): Promise<void> {
  const { log, bold, errorColor, success: successColor } = await import('../ui.js');
  const {
    hashLesson,
    readAllLessons,
    extractRuleExamples,
    verifyRuleExamples,
    formatExampleFailure,
  } = await import('@mmnto/totem');

  const { rules, totemDir } = await loadRulesOrExit();

  if (rules.length === 0) {
    log.error('Totem Error', 'No compiled rules found. Run `totem compile` first.');
    return;
  }

  const rule = resolveRuleByPrefix(rules, id, log, bold);
  if (!rule) return;

  // Find source lesson — search all lessons for one whose hash matches the rule's lessonHash
  const lessons = readAllLessons(totemDir);
  const lesson = lessons.find((l) => hashLesson(l.heading, l.body) === rule.lessonHash);

  if (!lesson) {
    log.warn(TAG, `Source lesson for rule ${bold(rule.lessonHash)} not found in .totem/lessons/`);
    log.dim(TAG, 'The lesson may have been removed or the hash may have changed.');
    return;
  }

  // Check for Example Hit/Miss
  const examples = extractRuleExamples(lesson.body);
  if (!examples) {
    log.warn(TAG, 'No Example Hit/Miss found in lesson for this rule. Add examples to test.');
    return;
  }

  // Run verification using the same logic as compile
  const result = verifyRuleExamples(rule, lesson.body);

  if (!result) {
    // verifyRuleExamples returns null for non-regex engines with no examples
    log.warn(TAG, `Engine '${rule.engine}' does not support inline example testing.`);
    return;
  }

  console.error('');
  if (result.passed) {
    const label = successColor(bold('PASS'));
    log.info(TAG, `${label} \u2014 ${rule.lessonHeading}`);
    log.dim(TAG, `${examples.hits.length} hit(s), ${examples.misses.length} miss(es) verified`);
  } else {
    const label = errorColor(bold('FAIL'));
    log.info(TAG, `${label} \u2014 ${rule.lessonHeading}`);
    log.warn(TAG, formatExampleFailure(result));
  }
  console.error('');
}
