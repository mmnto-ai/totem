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
    if (rules.length === 0) {
      printJson({
        status: 'error',
        command: 'rule list',
        // eslint-disable-next-line id-match -- JSON API field name
        error: { message: 'No compiled rules found', fix: 'Run totem compile', code: 'NO_RULES' },
      });
    } else {
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
    }
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

export async function ruleScaffoldCommand(id: string, opts: { out?: string }): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log, bold } = await import('../ui.js');
  const {
    deriveVirtualFilePath,
    extractRuleExamples,
    hashLesson,
    readAllLessons,
    scaffoldFixture,
    scaffoldFixturePath,
  } = await import('@mmnto/totem');

  const { rules, totemDir } = await loadRulesOrExit();

  if (rules.length === 0) {
    log.error('Totem Error', 'No compiled rules found. Run `totem compile` first.');
    return;
  }

  const rule = resolveRuleByPrefix(rules, id, log, bold);
  if (!rule) return;

  // Determine output path
  const testsDir = path.join(totemDir, 'tests');
  const outPath = opts.out ?? scaffoldFixturePath(testsDir, rule.lessonHash);

  if (fs.existsSync(outPath)) {
    log.warn(TAG, `Fixture already exists: ${path.relative(process.cwd(), outPath)}`);
    return;
  }

  // Find source lesson for Example Hit/Miss seed content
  const lessons = readAllLessons(totemDir);
  const lesson = lessons.find((l) => hashLesson(l.heading, l.body) === rule.lessonHash);
  const examples = lesson ? extractRuleExamples(lesson.body) : null;

  const content = scaffoldFixture({
    ruleHash: rule.lessonHash,
    filePath: deriveVirtualFilePath(rule),
    failLines: examples?.hits,
    passLines: examples?.misses,
    heading: rule.lessonHeading,
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf8');
  log.success(TAG, `Scaffolded fixture → ${bold(path.relative(process.cwd(), outPath))}`);
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

/**
 * Promote an unverified rule to active (remove the `unverified` flag).
 *
 * ADR-089 zero-trust default (mmnto-ai/totem#1581): newly compiled
 * LLM-generated rules ship with `unverified: true`. They stay silent at
 * lint time until a human explicitly promotes them or the ADR-091 Stage 4
 * Codebase Verifier (1.16.0) empirically validates them.
 *
 * Atomic surface: reads the full manifest (including archived rules),
 * validates the target is an active unverified rule, flips the flag,
 * writes `compiled-rules.json` via tmp + rename, recomputes the
 * manifest's `output_hash`, and writes the manifest back. All in one
 * command so hand-editing `compiled-rules.json` plus manual manifest
 * refresh never becomes the blessed path.
 */
export async function rulePromoteCommand(id: string): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log, bold } = await import('../ui.js');
  const { loadCompiledRulesFile, generateOutputHash, readCompileManifest, writeCompileManifest } =
    await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const manifestPath = path.join(totemDir, 'compile-manifest.json');

  if (!fs.existsSync(rulesPath)) {
    log.error('Totem Error', `No compiled-rules.json at ${rulesPath}. Run 'totem compile' first.`);
    process.exitCode = 1;
    return;
  }

  const manifest = loadCompiledRulesFile(rulesPath);
  const matches = manifest.rules.filter((r) =>
    r.lessonHash.toLowerCase().startsWith(id.toLowerCase()),
  );

  if (matches.length === 0) {
    log.error('Totem Error', `No rule found matching '${id}'`);
    process.exitCode = 1;
    return;
  }

  if (matches.length > 1) {
    log.warn(TAG, `Ambiguous prefix '${id}' matches ${matches.length} rules:`);
    for (const m of matches) {
      log.info(TAG, `  ${bold(m.lessonHash)} \u2014 ${m.lessonHeading}`);
    }
    log.dim(TAG, 'Provide more characters to disambiguate.');
    process.exitCode = 1;
    return;
  }

  const rule = matches[0]!;

  if (rule.status === 'archived') {
    log.error('Totem Error', `Rule ${rule.lessonHash} is archived. Unarchive it before promoting.`);
    process.exitCode = 1;
    return;
  }

  if (rule.unverified !== true) {
    log.warn(
      TAG,
      `Rule ${rule.lessonHash} is already verified (unverified flag absent or false). No action.`,
    );
    return;
  }

  // Delete the field rather than writing `unverified: false`. Absence is
  // the canonical "verified" state per the CompiledRuleSchema docs; see
  // compiler-schema.ts on the `unverified` field which explicitly says
  // "Never write literal `false`". Preserves pre-#1480 manifest hashes
  // when an unverified rule gets promoted back to the original shape.
  delete rule.unverified;

  // Atomic write with the same JSON.stringify(data, null, 2) + '\n' shape
  // used by compile-lesson.ts and rule-mutator.ts — the canonical on-disk
  // format for compiled-rules.json. Manifest hashes are canonicalized
  // inside `generateOutputHash` below; the write itself matches the
  // existing convention byte-for-byte. Tmp-file + rename prevents torn
  // writes if the process crashes mid-save.
  const tmpPath = `${rulesPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf-8' });
  fs.renameSync(tmpPath, rulesPath);

  // Refresh the manifest's output_hash so verify-manifest passes on the
  // next push. Keeps the blessed path atomic instead of asking the user
  // to run a separate refresh command.
  const compileManifest = readCompileManifest(manifestPath);
  compileManifest.output_hash = generateOutputHash(rulesPath);
  compileManifest.compiled_at = new Date().toISOString();
  writeCompileManifest(manifestPath, compileManifest);

  log.success(TAG, `Promoted rule ${bold(rule.lessonHash)} — ${rule.lessonHeading}`);
  log.dim(TAG, 'Manifest refreshed. `totem verify-manifest` should pass.');
}
