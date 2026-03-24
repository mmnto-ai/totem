import type { CompiledRule, CompiledRulesFile, LessonInput } from '@mmnto/totem';
import { TotemConfigError, TotemError } from '@mmnto/totem';

import { COMPILER_SYSTEM_PROMPT } from './compile-templates.js';

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

// ─── Main command ───────────────────────────────────

export async function compileCommand(options: CompileOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath, runOrchestrator } = await import('../utils.js');
  const {
    buildCompiledRule,
    buildManualRule,
    compileLesson: compileLessonCore,
    exportLessons,
    extractManualPattern,
    hashLesson,
    loadCompiledRulesFile,
    parseCompilerResponse,
    readAllLessons,
    saveCompiledRulesFile,
  } = await import('@mmnto/totem');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
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

  // ─── Pre-compilation gate: validate Pipeline 1 metadata ──
  {
    const { validateLessons } = await import('@mmnto/totem');
    const lintResult = validateLessons(lessons);
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

  // ─── Phase 1: Regex compilation (requires orchestrator) ──
  if (config.orchestrator) {
    const existingFile: CompiledRulesFile = options.force
      ? { version: 1, rules: [], nonCompilable: [] }
      : loadCompiledRulesFile(rulesPath);
    const existingRules = existingFile.rules;
    const existingByHash = new Map(existingRules.map((r) => [r.lessonHash, r]));
    const nonCompilableSet = new Set(existingFile.nonCompilable ?? []);

    const toCompile: LessonInput[] = [];

    for (const lesson of lessons) {
      const hash = hashLesson(lesson.heading, lesson.body);
      if (existingByHash.has(hash)) continue; // already compiled
      if (nonCompilableSet.has(hash)) continue; // cached as non-compilable
      toCompile.push({ index: lesson.index, heading: lesson.heading, body: lesson.body, hash });
    }

    if (toCompile.length === 0) {
      log.success(
        TAG,
        `All ${lessons.length} lessons already processed (${existingRules.length} compiled, ${nonCompilableSet.size} non-compilable). Use --force to recompile.`,
      ); // totem-ignore
    } else {
      const { createSpinner } = await import('../ui.js');
      const spinner = await createSpinner(TAG);

      let compiled = 0;
      let skipped = 0;
      let failed = 0;
      let processed = 0;
      const total = toCompile.length;
      const newRules: CompiledRule[] = [...existingRules];

      const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
      const freshRules = newRules.filter((r) => currentHashes.has(r.lessonHash));
      const pruned = newRules.length - freshRules.length;
      if (pruned > 0) {
        log.dim(TAG, `Pruned ${pruned} stale rules (lessons edited or removed)`); // totem-ignore
      }
      newRules.length = 0;
      newRules.push(...freshRules);

      const coreDeps = {
        parseCompilerResponse,
        runOrchestrator: (prompt: string) =>
          runOrchestrator({ prompt, tag: TAG, options, config, cwd, temperature: 0 }),
        existingByHash,
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
            // ADR-065: Pipeline 1 error rules require a test fixture
            if (manualResult.rule.severity === 'error' && !testedHashes.has(lesson.hash)) {
              manualResult.rule.severity = 'warning';
              log.warn(
                TAG,
                `[${lesson.heading}] Downgraded to warning — no test fixture in .totem/tests/ (ADR-065)`,
              );
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
            `${newRules.length} rules — ${compiled} compiled (all manual, no cloud call needed)`,
          );
        } else {
          log.info(TAG, `Cloud compile: ${cloudLessons.length} lessons → ${cloudUrl}`);

          // Resolve auth token for Cloud Run (uses gcloud identity token or TOTEM_CLOUD_TOKEN env)
          const cloudToken =
            process.env['TOTEM_CLOUD_TOKEN'] ??
            (await (async () => {
              try {
                const { execSync } = await import('node:child_process');
                return execSync('gcloud auth print-identity-token', { encoding: 'utf-8' }).trim();
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
              skipped++;
              continue;
            }

            const ruleResult = buildCompiledRule(parsed, lesson, existingByHash);
            if (ruleResult.rule) {
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
        const parsed = Number(options.concurrency ?? DEFAULT_CONCURRENCY);
        const CONCURRENCY = Math.min(
          MAX_CONCURRENCY,
          Math.max(1, Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : parsed),
        );
        for (let i = 0; i < toCompile.length; i += CONCURRENCY) {
          const batch = toCompile.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map((lesson) =>
              compileLessonCore(lesson, COMPILER_SYSTEM_PROMPT, coreDeps)
                .then((result) => ({ lesson, result }))
                .catch((err) => {
                  const message = err instanceof Error ? err.message : String(err);
                  log.warn(TAG, `[${lesson.heading}] ${message} — skipping`);
                  return { lesson, result: { status: 'failed' as const } };
                }),
            ),
          );

          processed += batch.length;
          spinner.update(
            `${processed}/${total} lessons (${Math.round((processed / total) * 100)}%)`,
          );

          for (const { lesson, result } of results) {
            switch (result.status) {
              case 'compiled':
                // ADR-065: Pipeline 1 error rules require a test fixture
                if (
                  extractManualPattern(lesson.body) &&
                  result.rule.severity === 'error' &&
                  !testedHashes.has(lesson.hash)
                ) {
                  result.rule.severity = 'warning';
                  log.warn(
                    TAG,
                    `[${lesson.heading}] Downgraded to warning — no test fixture in .totem/tests/ (ADR-065)`,
                  );
                }
                newRules.push(result.rule);
                compiled++;
                logCompiledRule(log, lesson, result.rule);
                break;
              case 'skipped':
                nonCompilableSet.add(result.hash);
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
