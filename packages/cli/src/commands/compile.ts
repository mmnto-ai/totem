import type { CompiledRule, CompiledRulesFile, LessonInput } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────

const TAG = 'Compile';
const COMPILED_RULES_FILE = 'compiled-rules.json';
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;
const CLOUD_CONCURRENCY = 50;

// ─── Types ──────────────────────────────────────────

export interface CompileOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  force?: boolean;
  export?: boolean;
  fromCursor?: boolean;
  concurrency?: string;
  cloud?: string;
  verbose?: boolean;
  /**
   * Telemetry-driven re-compile (mmnto/totem#1131). Filters lessons to a single hash
   * (full or short prefix), bypasses the cache, and threads a non-code-ratio
   * directive into the Pipeline 2 system prompt.
   */
  upgrade?: string;
}

// ─── Telemetry directive (mmnto/totem#1131) ────────────────────

/**
 * Build the directive injected into the Sonnet system prompt for `--upgrade`.
 *
 * `unknown` is excluded from both the numerator and the denominator because it
 * holds historical / unclassified telemetry (pre-context-aware hits, or events
 * where the rule runner did not provide an `astContext`). Including it would
 * dilute the classified signal and produce misleading ratios.
 */
export function buildTelemetryPrefix(contextCounts: {
  code: number;
  string: number;
  comment: number;
  regex: number;
  unknown: number;
}): string {
  const classifiedTotal =
    contextCounts.code + contextCounts.string + contextCounts.comment + contextCounts.regex;
  const nonCode = contextCounts.string + contextCounts.comment + contextCounts.regex;
  const pct = classifiedTotal > 0 ? Math.round((nonCode / classifiedTotal) * 100) : 0;
  const unknownNote =
    contextCounts.unknown > 0
      ? ` Unclassified (historical) matches: ${contextCounts.unknown}.`
      : '';
  return [
    `This rule was flagged because ${pct}% of its classified matches occur in non-code contexts`,
    `(strings: ${contextCounts.string}, comments: ${contextCounts.comment}, regex literals: ${contextCounts.regex}). Please prefer an ast-grep`,
    `structural pattern that only matches executable code, not string or comment content.${unknownNote}`,
  ].join(' ');
}

// ─── Logging helpers ────────────────────────────────

function logCompiledRule(
  log: { success: (tag: string, msg: string) => void },
  lesson: LessonInput,
  rule: CompiledRule,
): void {
  const engine = rule.engine;
  const severity = rule.severity ?? 'warning';
  if (engine === 'ast-grep') {
    log.success(
      TAG,
      `[${lesson.heading}] Compiled (ast-grep, ${severity}): ${rule.astGrepPattern}`,
    ); // totem-ignore
  } else if (engine === 'ast') {
    log.success(TAG, `[${lesson.heading}] Compiled (ast, ${severity}): ${rule.astQuery}`); // totem-ignore
  } else if (rule.lessonHeading === rule.message) {
    // Manual pattern — message equals heading
    const manualEngine = rule.engine;
    log.success(
      TAG,
      `[${lesson.heading}] Compiled (manual ${manualEngine}, ${severity}): ${rule.pattern}`,
    ); // totem-ignore
  } else {
    log.success(TAG, `[${lesson.heading}] Compiled (regex, ${severity}): /${rule.pattern}/`); // totem-ignore
  }
}

// ─── Test fixture lookup (ADR-065) ──────────────────

function getTestedHashes(
  testsDir: string,
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
): Set<string> {
  const hashes = new Set<string>();
  try {
    if (!fs.existsSync(testsDir)) return hashes;
    for (const file of fs.readdirSync(testsDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
      const match = content.match(/^rule:\s*(\S+)/m);
      if (match) hashes.add(match[1]);
    }
  } catch {
    // tests dir unreadable
  }
  return hashes;
}

// ─── Auto-scaffold (ADR-065 / #854) ─────────────────

export interface AutoScaffoldDeps {
  fs: typeof import('node:fs');
  path: typeof import('node:path');
  testsDir: string;
  cwd: string;
  testedHashes: Set<string>;
  log: { info: (tag: string, msg: string) => void };
  extractRuleExamples: typeof import('@mmnto/totem').extractRuleExamples;
  deriveVirtualFilePath: typeof import('@mmnto/totem').deriveVirtualFilePath;
  scaffoldFixture: typeof import('@mmnto/totem').scaffoldFixture;
  scaffoldFixturePath: typeof import('@mmnto/totem').scaffoldFixturePath;
}

/** Returns true if the fixture was written, false on failure. */
export function autoScaffoldFixture(
  lesson: LessonInput,
  rule: CompiledRule,
  deps: AutoScaffoldDeps,
): boolean {
  try {
    const examples = deps.extractRuleExamples(lesson.body);
    const virtualPath = deps.deriveVirtualFilePath(rule);
    const content = deps.scaffoldFixture({
      ruleHash: lesson.hash,
      filePath: virtualPath,
      failLines: examples?.hits,
      passLines: examples?.misses,
      heading: lesson.heading,
    });
    const fixturePath = deps.scaffoldFixturePath(deps.testsDir, lesson.hash);
    deps.fs.mkdirSync(deps.path.dirname(fixturePath), { recursive: true });
    deps.fs.writeFileSync(fixturePath, content, { encoding: 'utf8', flag: 'wx' });
    deps.testedHashes.add(lesson.hash);
    deps.log.info(
      TAG,
      `[${lesson.heading}] Auto-scaffolded test fixture → ${deps.path.relative(deps.cwd, fixturePath)}`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log.info(TAG, `[${lesson.heading}] Failed to scaffold fixture (non-fatal): ${msg}`);
    return false;
  }
}

// ─── Main command ───────────────────────────────────

export async function compileCommand(options: CompileOptions): Promise<void> {
  const { TotemConfigError, TotemError } = await import('@mmnto/totem');
  const { COMPILER_SYSTEM_PROMPT, PIPELINE3_COMPILER_PROMPT } =
    await import('./compile-templates.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log } = await import('../ui.js');
  const { isGlobalConfigPath, loadConfig, loadEnv, resolveConfigPath, runOrchestrator } =
    await import('../utils.js');
  const {
    buildCompiledRule,
    buildManualRule,
    compileLesson: compileLessonCore,
    deriveVirtualFilePath,
    exportLessons,
    extractManualPattern,
    extractRuleExamples,
    formatExampleFailure,
    hashLesson,
    loadCompiledRulesFile,
    parseCompilerResponse,
    readAllLessons,
    saveCompiledRulesFile,
    scaffoldFixture,
    scaffoldFixturePath,
    verifyRuleExamples,
  } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  if (isGlobalConfigPath(configPath)) {
    throw new TotemConfigError(
      'Cannot compile rules without a local project.',
      "Run 'totem init' to create a local .totem/ directory first.",
      'CONFIG_MISSING',
    );
  }
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, COMPILED_RULES_FILE);

  const lessons = readAllLessons(totemDir);

  // Ingest cursor instructions if --from-cursor
  if (options.fromCursor) {
    const { scanCursorInstructions } = await import('@mmnto/totem');
    const cursorInstructions = scanCursorInstructions(cwd);
    if (cursorInstructions.length > 0) {
      log.info(TAG, `Found ${cursorInstructions.length} Cursor instruction(s)`); // totem-ignore
      for (const instr of cursorInstructions) {
        const body = instr.body + (instr.globs ? `\n\nFile scope: ${instr.globs.join(', ')}` : '');
        lessons.push({
          index: lessons.length,
          heading: `[cursor] ${instr.heading}`,
          tags: ['cursor', 'ingested'],
          body,
          raw: `## Lesson — [cursor] ${instr.heading}\n\n**Tags:** cursor, ingested\n\n${body}`,
          sourcePath: instr.source,
        });
      }
    } else {
      log.dim(TAG, 'No .cursorrules or .cursor/rules/*.mdc files found.');
    }
  }

  if (lessons.length === 0) {
    throw new TotemError(
      'NO_LESSONS',
      'No lessons found. Nothing to compile.',
      'Add lessons with `totem extract <pr>` or create .totem/lessons/*.md files manually.',
    );
  }

  log.info(TAG, `Found ${lessons.length} lessons`); // totem-ignore

  // ─── Telemetry-driven re-compile (mmnto/totem#1131) ──
  // --upgrade <hash> targets ONE rule by hash (full or short prefix match), evicts
  // it from the cache so it alone gets recompiled, and threads a telemetry directive
  // into its Pipeline 2 prompt. All other rules pass through unchanged.
  //
  // `lessonsInScope` is what we validate and iterate for compilation. It starts
  // as the full lesson set (default behavior) and is narrowed to just the
  // target lesson for --upgrade so that:
  //   1. An unrelated invalid lesson can't abort the upgrade (validateLessons)
  //   2. An unrelated cache-miss lesson doesn't leak into the compile batch
  //   3. `totem doctor --pr` branches stay scoped to the flagged rule only
  // The full `lessons` array is still used for `currentHashes` pruning so the
  // other 389 compiled rules remain in newRules.
  let telemetryPrefix: string | undefined;
  let upgradeTargetHash: string | undefined;
  let lessonsInScope: typeof lessons = lessons;
  if (options.upgrade) {
    if (options.cloud) {
      throw new TotemError(
        'UPGRADE_CLOUD_UNSUPPORTED',
        '--upgrade is not supported with --cloud.',
        'Run `totem compile --upgrade <hash>` without --cloud. The cloud worker cannot thread a per-lesson telemetry directive yet (mmnto/totem#1221).',
      );
    }
    if (options.force) {
      // --force empties the cache before scoped eviction runs, silently turning
      // --upgrade into a full recompile. Reject the combo so intent is explicit.
      throw new TotemConfigError(
        '--upgrade cannot be combined with --force.',
        'Run `totem compile --upgrade <hash>` without --force. The upgrade path already bypasses the cache for the target rule only, preserving every other compiled rule.',
        'CONFIG_INVALID',
      );
    }

    const target = options.upgrade.toLowerCase();
    const matches = lessons.filter((l) => {
      const lessonHash = hashLesson(l.heading, l.body).toLowerCase();
      return lessonHash === target || lessonHash.startsWith(target);
    });

    if (matches.length === 0) {
      throw new TotemError(
        'UPGRADE_HASH_NOT_FOUND',
        `No lesson matches hash '${options.upgrade}'.`,
        'Run `totem doctor` to see flagged upgrade candidates, then re-run with the printed hash.',
      );
    }
    if (matches.length > 1) {
      const found = matches
        .map((m) => `${hashLesson(m.heading, m.body)} (${m.heading})`)
        .join(', ');
      throw new TotemError(
        'UPGRADE_HASH_AMBIGUOUS',
        `Hash prefix '${options.upgrade}' matches ${matches.length} lessons: ${found}`,
        'Use the full hash to disambiguate.',
      );
    }

    upgradeTargetHash = hashLesson(matches[0]!.heading, matches[0]!.body);
    lessonsInScope = [matches[0]!];
    log.info(TAG, `--upgrade: targeting ${upgradeTargetHash} (${matches[0]!.heading})`);

    // Load existing telemetry to build the directive
    try {
      const { loadRuleMetrics } = await import('@mmnto/totem');
      const metricsFile = loadRuleMetrics(totemDir);
      const metric = metricsFile.rules[upgradeTargetHash];
      if (metric?.contextCounts) {
        telemetryPrefix = buildTelemetryPrefix(metric.contextCounts);
        log.dim(TAG, `--upgrade: telemetry directive prepared (${telemetryPrefix.length} chars)`);
      } else {
        log.warn(
          TAG,
          `--upgrade: no telemetry found for ${upgradeTargetHash}; recompiling without directive.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `--upgrade: failed to load telemetry — ${msg}`);
    }
  }

  // ─── Pre-compilation gate: validate Pipeline 1 metadata ──
  // For --upgrade, scope validation to the target so unrelated invalid lessons
  // cannot block the upgrade (mmnto/totem#1234 CR finding).
  {
    const { validateLessons } = await import('@mmnto/totem');
    const lintResult = validateLessons(lessonsInScope);
    const errors = lintResult.diagnostics.filter((d) => d.severity === 'error');
    const warnings = lintResult.diagnostics.filter((d) => d.severity === 'warning');
    for (const d of warnings) {
      log.warn(TAG, `${d.lessonHeading}: [${d.field}] ${d.message}`);
    }
    if (errors.length > 0) {
      for (const d of errors) {
        log.error('Totem Error', `${d.lessonHeading}: [${d.field}] ${d.message}`);
      }
      throw new TotemError(
        'LINT_LESSONS_FAILED',
        `${errors.length} lesson(s) have invalid metadata. Fix them before compiling.`,
        'Run `totem lint-lessons` for details.',
      );
    }
  }

  // ─── Test fixture lookup (ADR-065) ──
  const testsDir = path.join(totemDir, 'tests');
  const testedHashes = getTestedHashes(testsDir, fs, path);

  const scaffoldDeps: AutoScaffoldDeps = {
    fs,
    path,
    testsDir,
    cwd,
    testedHashes,
    log,
    extractRuleExamples,
    deriveVirtualFilePath,
    scaffoldFixture,
    scaffoldFixturePath,
  };

  // ─── Phase 1: Regex compilation (requires orchestrator) ──
  if (config.orchestrator) {
    const existingFile: CompiledRulesFile = options.force
      ? { version: 1, rules: [], nonCompilable: [] }
      : loadCompiledRulesFile(rulesPath);
    const existingRules = existingFile.rules;
    const existingByHash = new Map(existingRules.map((r) => [r.lessonHash, r]));
    const nonCompilableSet = new Set(existingFile.nonCompilable ?? []);

    // Note: we do NOT delete the --upgrade target from existingByHash here.
    // buildCompiledRule in @mmnto/totem looks up the old entry to preserve
    // metadata (createdAt, audit lineage). Deleting would make the upgraded
    // rule look brand-new and break garbage-collection heuristics. Instead,
    // we bypass the cache check for the target inside the loop below.

    const toCompile: LessonInput[] = [];

    // For --upgrade, iterate only the target lesson so unrelated cache-miss
    // lessons don't leak into the compile batch (mmnto/totem#1234 CR finding).
    for (const lesson of lessonsInScope) {
      const hash = hashLesson(lesson.heading, lesson.body);
      // --upgrade: always recompile the target, even if it's in the cache or
      // was previously marked non-compilable. The telemetry directive may
      // unlock a pattern the compiler couldn't produce on the first pass.
      if (hash !== upgradeTargetHash) {
        if (existingByHash.has(hash)) continue; // already compiled
        if (nonCompilableSet.has(hash)) continue; // cached as non-compilable
      }
      toCompile.push({ index: lesson.index, heading: lesson.heading, body: lesson.body, hash });
    }

    if (toCompile.length === 0) {
      log.success(
        TAG,
        `All ${lessonsInScope.length} lesson(s) in scope already processed (${existingRules.length} compiled, ${nonCompilableSet.size} non-compilable). Use --force to recompile.`,
      ); // totem-ignore
    } else {
      const { createSpinner } = await import('../ui.js');
      const spinner = await createSpinner(TAG, 'Compiling...');

      let compiled = 0;
      let skipped = 0;
      let failed = 0;
      const skippedLessons: { heading: string; reason?: string }[] = [];
      const newRules: CompiledRule[] = [...existingRules];

      const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
      const freshRules = newRules.filter((r) => currentHashes.has(r.lessonHash));
      const pruned = newRules.length - freshRules.length;
      if (pruned > 0) {
        log.dim(TAG, `Pruned ${pruned} stale rules (lessons edited or removed)`); // totem-ignore
      }
      newRules.length = 0;
      newRules.push(...freshRules);

      // --upgrade: the stale copy is NOT pre-filtered here. If we removed it now
      // and compilation failed (network error, LLM refusal, parser failure), the
      // rule would be silently deleted from compiled-rules.json. Instead, we
      // splice the stale copy inside the `case 'compiled':` handler below, so
      // the fresh rule only replaces the old one on a successful re-compile.

      const coreDeps = {
        parseCompilerResponse,
        runOrchestrator: (prompt: string) =>
          runOrchestrator({ prompt, tag: TAG, options, config, cwd, temperature: 0 }),
        existingByHash,
        pipeline3Prompt: PIPELINE3_COMPILER_PROMPT,
        callbacks: {
          onWarn: (heading: string, msg: string) => log.warn(TAG, `[${heading}] ${msg}`),
          onDim: (heading: string, msg: string) => log.dim(TAG, `[${heading}] ${msg}`),
        },
      };

      // ─── Cloud compilation (Proposal 188 Phase 2) ───
      if (options.cloud) {
        const cloudUrl = options.cloud;

        // Compile manual patterns locally first (zero LLM, instant)
        const cloudLessons: LessonInput[] = [];
        for (const lesson of toCompile) {
          const manualResult = buildManualRule(lesson, existingByHash);
          if (manualResult.rule) {
            // Verify rule against inline Example Hit/Miss lines
            const testResult = verifyRuleExamples(manualResult.rule, lesson.body);
            if (testResult && !testResult.passed) {
              log.warn(TAG, `[${lesson.heading}] ${formatExampleFailure(testResult)}`);
              failed++;
              continue;
            }
            // ADR-065: Pipeline 1 error rules require a test fixture
            if (manualResult.rule.severity === 'error' && !testedHashes.has(lesson.hash)) {
              if (options.raw || !autoScaffoldFixture(lesson, manualResult.rule, scaffoldDeps)) {
                manualResult.rule.severity = 'warning';
                log.warn(
                  TAG,
                  `[${lesson.heading}] Downgraded to warning — no test fixture (ADR-065)`,
                );
              }
            }
            newRules.push(manualResult.rule);
            compiled++;
            logCompiledRule(log, lesson, manualResult.rule);
          } else if (manualResult.rejectReason) {
            log.warn(TAG, `[${lesson.heading}] ${manualResult.rejectReason}`);
            failed++;
          } else {
            cloudLessons.push(lesson);
          }
        }

        // Skip cloud call if all lessons were manual
        if (cloudLessons.length === 0) {
          spinner.succeed(
            `${newRules.length} rules — ${compiled} compiled${failed > 0 ? `, ${failed} failed` : ''} (all manual, no cloud call needed)`,
          );
        } else {
          log.info(TAG, `Cloud compile: ${cloudLessons.length} lessons → ${cloudUrl}`);

          // Resolve auth token for Cloud Run (uses gcloud identity token or TOTEM_CLOUD_TOKEN env)
          const cloudToken =
            process.env['TOTEM_CLOUD_TOKEN'] ??
            (await (async () => {
              try {
                const { safeExec } = await import('@mmnto/totem');
                return safeExec('gcloud', ['auth', 'print-identity-token']);
              } catch {
                return undefined;
              }
            })());

          // DLP: scrub secrets from lesson content before sending off-machine
          const { maskSecrets } = await import('@mmnto/totem');
          const scrubbedLessons = cloudLessons.map((l) => ({
            heading: maskSecrets(l.heading),
            body: maskSecrets(l.body),
            hash: l.hash,
          }));

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (cloudToken) headers['Authorization'] = `Bearer ${cloudToken}`;

          const response = await fetch(`${cloudUrl}/compile`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              lessons: scrubbedLessons,
              prompt: COMPILER_SYSTEM_PROMPT,
              model: options.model ?? config.orchestrator?.defaultModel ?? 'gemini-3-flash-preview',
              concurrency: CLOUD_CONCURRENCY,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new TotemError(
              'COMPILE_FAILED',
              `Cloud compile failed: ${text}`,
              'Check the cloud endpoint.',
            );
          }

          const data = (await response.json()) as {
            results: { hash: string; response: string | null; err?: string }[];
            stats: { elapsed_seconds: number; succeeded: number; failed: number };
          };

          log.info(
            TAG,
            `Cloud: ${data.stats.succeeded} succeeded, ${data.stats.failed} failed in ${data.stats.elapsed_seconds}s`,
          );

          for (const cloudResult of data.results) {
            if (!cloudResult.response) {
              failed++;
              continue;
            }

            const lesson = toCompile.find((l) => l.hash === cloudResult.hash);
            if (!lesson) continue;

            const parsed = parseCompilerResponse(cloudResult.response!);
            if (!parsed) {
              failed++;
              continue;
            }
            if (!parsed.compilable) {
              nonCompilableSet.add(lesson.hash);
              skippedLessons.push({ heading: lesson.heading, reason: parsed.reason });
              skipped++;
              continue;
            }

            const ruleResult = buildCompiledRule(parsed, lesson, existingByHash);
            if (ruleResult.rule) {
              // Verify rule against inline Example Hit/Miss lines
              const testResult = verifyRuleExamples(ruleResult.rule, lesson.body);
              if (testResult && !testResult.passed) {
                log.warn(TAG, `[${lesson.heading}] ${formatExampleFailure(testResult)}`);
                failed++;
                continue;
              }
              newRules.push(ruleResult.rule);
              compiled++;
              logCompiledRule(log, lesson, ruleResult.rule);
            } else {
              if (ruleResult.rejectReason) {
                log.warn(TAG, `[${lesson.heading}] ${ruleResult.rejectReason} — skipping`);
              }
              failed++;
            }
          }

          spinner.succeed(
            `${newRules.length} rules — ${compiled} compiled, ${skipped} skipped, ${failed} failed (cloud: ${data.stats.elapsed_seconds}s)`,
          );
        } // end cloudLessons.length > 0
      } else {
        // Compile lessons in parallel batches (Proposal 188 Phase 1)
        const { ProgressTracker } = await import('../progress.js');
        const { withRetry } = await import('../retry.js');
        const tracker = new ProgressTracker(toCompile.length);
        spinner.update(tracker.format());

        const parsed = Number(options.concurrency ?? DEFAULT_CONCURRENCY);
        const CONCURRENCY = Math.min(
          MAX_CONCURRENCY,
          Math.max(1, Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : parsed),
        );
        for (let i = 0; i < toCompile.length; i += CONCURRENCY) {
          const batch = toCompile.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map((lesson) => {
              // Per-lesson deps: telemetry prefix only applies to the --upgrade target.
              const lessonDeps =
                lesson.hash === upgradeTargetHash ? { ...coreDeps, telemetryPrefix } : coreDeps;
              return withRetry(
                () => compileLessonCore(lesson, COMPILER_SYSTEM_PROMPT, lessonDeps),
                {
                  onRetry: (attempt, delayMs) => {
                    log.warn(
                      TAG,
                      `[${lesson.heading}] Rate limited — retry ${attempt} in ${delayMs}ms`,
                    );
                  },
                },
              )
                .then((result) => {
                  tracker.tick();
                  spinner.update(tracker.format());
                  return { lesson, result };
                })
                .catch((err) => {
                  tracker.tick();
                  spinner.update(tracker.format());
                  const message = err instanceof Error ? err.message : String(err);
                  log.warn(TAG, `[${lesson.heading}] ${message} — skipping`);
                  return { lesson, result: { status: 'failed' as const } };
                });
            }),
          );

          for (const { lesson, result } of results) {
            // --upgrade: remove the stale copy from newRules up front for any
            // terminal outcome where the rule's state CHANGES (compiled → new
            // pattern replaces old; skipped → rule moves to nonCompilable and
            // must no longer appear as an active rule). For `failed`
            // (transient error) and `noop` (no change), leave the old rule
            // intact so a flaky network / rate-limit doesn't silently delete
            // work (mmnto/totem#1234 GCA finding).
            if (
              lesson.hash === upgradeTargetHash &&
              (result.status === 'compiled' || result.status === 'skipped')
            ) {
              const staleIdx = newRules.findIndex((r) => r.lessonHash === upgradeTargetHash);
              if (staleIdx >= 0) newRules.splice(staleIdx, 1);
            }

            switch (result.status) {
              case 'compiled':
                // ADR-065: Pipeline 1 error rules require a test fixture
                if (
                  extractManualPattern(lesson.body) &&
                  result.rule.severity === 'error' &&
                  !testedHashes.has(lesson.hash)
                ) {
                  if (options.raw || !autoScaffoldFixture(lesson, result.rule, scaffoldDeps)) {
                    result.rule.severity = 'warning';
                    log.warn(
                      TAG,
                      `[${lesson.heading}] Downgraded to warning — no test fixture (ADR-065)`,
                    );
                  }
                }
                // --upgrade: also clear any stale nonCompilable entry so the
                // successfully-compiled rule doesn't coexist with a
                // non-compilable marker for the same hash.
                if (lesson.hash === upgradeTargetHash) {
                  nonCompilableSet.delete(upgradeTargetHash);
                }
                newRules.push(result.rule);
                compiled++;
                logCompiledRule(log, lesson, result.rule);
                break;
              case 'skipped':
                nonCompilableSet.add(result.hash);
                skippedLessons.push({ heading: lesson.heading, reason: result.reason });
                skipped++;
                break;
              case 'failed':
                failed++;
                break;
              case 'noop':
                break;
            }
          }
        }
      } // end cloud/local else

      if (!options.raw) {
        // Prune stale non-compilable hashes (lesson was edited or removed)
        const freshNonCompilable = [...nonCompilableSet].filter((h) => currentHashes.has(h));
        saveCompiledRulesFile(rulesPath, {
          version: 1,
          rules: newRules,
          nonCompilable: freshNonCompilable,
        });

        // ─── Write compile manifest (provenance chain) ───
        const { generateInputHash, generateOutputHash, writeCompileManifest } =
          await import('@mmnto/totem');
        const lessonsDir = path.join(totemDir, 'lessons');
        const manifestPath = path.join(totemDir, 'compile-manifest.json');
        const inputHash = generateInputHash(lessonsDir);
        const outputHash = generateOutputHash(rulesPath);
        writeCompileManifest(manifestPath, {
          compiled_at: new Date().toISOString(),
          model: options.model ?? config.orchestrator?.defaultModel ?? 'unknown',
          input_hash: inputHash,
          output_hash: outputHash,
          rule_count: newRules.length,
        });
        log.dim(TAG, `Manifest: ${inputHash.slice(0, 8)}…→${outputHash.slice(0, 8)}…`);

        spinner.succeed(
          `${newRules.length} rules — ${compiled} compiled, ${skipped} skipped, ${failed} failed`,
        );

        // ─── Skipped lesson transparency (#1060) ───
        if (skippedLessons.length > 0) {
          log.warn(TAG, `${skippedLessons.length} lesson(s) could not be compiled into rules.`);
          if (options.verbose) {
            for (const sl of skippedLessons) {
              const detail = sl.reason ?? 'no reason provided';
              log.dim(TAG, `  ↳ ${sl.heading}: ${detail}`);
            }
          } else {
            log.dim(TAG, 'Run totem compile --verbose to see why.');
          }
        }
      }
    }
  } else if (!options.export) {
    throw new TotemConfigError(
      'No orchestrator configured. Regex compilation requires a Full-tier config.',
      'Use --export to export lessons to AI config files without an orchestrator.',
      'CONFIG_MISSING',
    );
  }

  // ─── Phase 2: Export to AI config files (deterministic, no LLM) ──
  if (options.export) {
    if (!config.exports || Object.keys(config.exports).length === 0) {
      log.warn(TAG, 'No export targets configured in totem.config.ts. Add an `exports` field.');
      return;
    }

    for (const [name, filePath] of Object.entries(config.exports)) {
      const absPath = path.join(cwd, filePath);
      exportLessons(lessons, absPath);
      log.success(TAG, `Exported ${lessons.length} rules to ${filePath} (${name})`); // totem-ignore
    }
  }
}
