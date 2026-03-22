import type { CompiledRule, CompiledRulesFile, CompilerOutput, TotemConfig } from '@mmnto/totem';
import { TotemConfigError, TotemError } from '@mmnto/totem';

import { COMPILER_SYSTEM_PROMPT } from './compile-templates.js';

// ─── Constants ──────────────────────────────────────

const TAG = 'Compile';
const COMPILED_RULES_FILE = 'compiled-rules.json';

// ─── Types ──────────────────────────────────────────

export interface CompileOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  force?: boolean;
  export?: boolean;
  fromCursor?: boolean;
}

interface LessonInput {
  index: number;
  heading: string;
  body: string;
  hash: string;
}

type CompileLessonResult =
  | { status: 'compiled'; rule: CompiledRule }
  | { status: 'skipped'; hash: string }
  | { status: 'failed' }
  | { status: 'noop' };

interface CompileLessonDeps {
  extractManualPattern: (body: string) => import('@mmnto/totem').ManualPattern | null;
  validateRegex: (pattern: string) => import('@mmnto/totem').RegexValidation;
  parseCompilerResponse: (response: string) => CompilerOutput | null;
  sanitizeFileGlobs: (globs: string[]) => string[];
  engineFields: (
    engine: 'regex' | 'ast' | 'ast-grep',
    pattern: string | Record<string, unknown>,
  ) => { pattern: string; astGrepPattern?: string | Record<string, unknown>; astQuery?: string };
  runOrchestrator: (opts: {
    prompt: string;
    tag: string;
    options: CompileOptions;
    config: TotemConfig;
    cwd: string;
  }) => Promise<string | undefined>;
  log: {
    warn: (tag: string, msg: string) => void;
    dim: (tag: string, msg: string) => void;
    success: (tag: string, msg: string) => void;
  };
  existingByHash: Map<string, CompiledRule>;
  options: CompileOptions;
  config: TotemConfig;
  cwd: string;
}

// ─── Single-lesson compilation ──────────────────────

async function compileLesson(
  lesson: LessonInput,
  deps: CompileLessonDeps,
): Promise<CompileLessonResult> {
  const {
    extractManualPattern,
    validateRegex,
    parseCompilerResponse,
    sanitizeFileGlobs,
    engineFields,
    runOrchestrator,
    log,
    existingByHash,
    options,
    config,
    cwd,
  } = deps;

  // ── Pipeline 1: Manual pattern (zero LLM) ────────
  const manual = extractManualPattern(lesson.body);
  if (manual) {
    // Validate the manually provided pattern
    if (manual.engine === 'regex') {
      const validation = validateRegex(manual.pattern);
      if (!validation.valid) {
        log.warn(
          TAG,
          `[${lesson.heading}] Manual pattern rejected: ${validation.reason} — skipping`,
        ); // totem-ignore
        return { status: 'failed' };
      }
    }

    const now = new Date().toISOString();
    const existing = existingByHash.get(lesson.hash);
    const sanitizedGlobs = manual.fileGlobs ? sanitizeFileGlobs(manual.fileGlobs) : undefined;
    return {
      status: 'compiled',
      rule: {
        lessonHash: lesson.hash,
        lessonHeading: lesson.heading,
        message: lesson.heading,
        engine: manual.engine,
        severity: manual.severity,
        ...engineFields(manual.engine, manual.pattern),
        compiledAt: now,
        createdAt: existing?.createdAt ?? now,
        ...(sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {}),
      },
    };
  }

  // ── Pipeline 2: LLM compilation ──────────────────
  const prompt = `${COMPILER_SYSTEM_PROMPT}\n\n## Lesson to Compile\n\nHeading: ${lesson.heading}\n\n${lesson.body}`;

  const response = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
  });

  if (response == null) {
    return { status: 'noop' };
  }

  const parsed = parseCompilerResponse(response);

  if (!parsed) {
    log.warn(TAG, `[${lesson.heading}] Failed to parse LLM response — skipping`); // totem-ignore
    return { status: 'failed' };
  }

  if (!parsed.compilable) {
    log.dim(TAG, `[${lesson.heading}] Not compilable (conceptual/architectural) — skipping`); // totem-ignore
    return { status: 'skipped', hash: lesson.hash };
  }

  // ── Gate 1: Severity validation (Proposal 184) ──
  const severity = parsed.severity ?? 'warning';
  const engine = parsed.engine ?? 'regex';

  // ── ast-grep engine ───────────────────────────
  if (engine === 'ast-grep') {
    if (!parsed.astGrepPattern || !parsed.message) {
      log.warn(TAG, `[${lesson.heading}] Missing astGrepPattern or message — skipping`); // totem-ignore
      return { status: 'failed' };
    }

    const now = new Date().toISOString();
    const existing = existingByHash.get(lesson.hash);
    const sanitizedGlobs = parsed.fileGlobs ? sanitizeFileGlobs(parsed.fileGlobs) : undefined;
    return {
      status: 'compiled',
      rule: {
        lessonHash: lesson.hash,
        lessonHeading: lesson.heading,
        message: parsed.message,
        engine: 'ast-grep',
        severity,
        ...engineFields('ast-grep', parsed.astGrepPattern),
        compiledAt: now,
        createdAt: existing?.createdAt ?? now,
        ...(sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {}),
      },
    };
  }

  // ── Tree-sitter AST engine ────────────────────
  if (engine === 'ast') {
    if (!parsed.astQuery || !parsed.message) {
      log.warn(TAG, `[${lesson.heading}] Missing astQuery or message — skipping`); // totem-ignore
      return { status: 'failed' };
    }

    const now = new Date().toISOString();
    const existing = existingByHash.get(lesson.hash);
    const sanitizedGlobs = parsed.fileGlobs ? sanitizeFileGlobs(parsed.fileGlobs) : undefined;
    return {
      status: 'compiled',
      rule: {
        lessonHash: lesson.hash,
        lessonHeading: lesson.heading,
        message: parsed.message,
        engine: 'ast',
        severity,
        ...engineFields('ast', parsed.astQuery),
        compiledAt: now,
        createdAt: existing?.createdAt ?? now,
        ...(sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {}),
      },
    };
  }

  // ── Regex engine (default) ────────────────────
  if (!parsed.pattern || !parsed.message) {
    log.warn(TAG, `[${lesson.heading}] Missing pattern or message — skipping`); // totem-ignore
    return { status: 'failed' };
  }

  const validation = validateRegex(parsed.pattern);
  if (!validation.valid) {
    log.warn(TAG, `[${lesson.heading}] Rejected regex: ${validation.reason} — skipping`); // totem-ignore
    return { status: 'failed' };
  }

  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = parsed.fileGlobs ? sanitizeFileGlobs(parsed.fileGlobs) : undefined;
  return {
    status: 'compiled',
    rule: {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'regex',
      severity,
      ...engineFields('regex', parsed.pattern),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...(sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {}),
    },
  };
}

function logCompiledRule(
  log: CompileLessonDeps['log'],
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
    engineFields,
    exportLessons,
    extractManualPattern,
    hashLesson,
    loadCompiledRulesFile,
    parseCompilerResponse,
    readAllLessons,
    sanitizeFileGlobs,
    saveCompiledRulesFile,
    validateRegex,
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
      log.info(
        TAG,
        `${toCompile.length} lessons need compilation (${existingRules.length} already compiled)`,
      );

      let compiled = 0;
      let skipped = 0;
      let failed = 0;
      const newRules: CompiledRule[] = [...existingRules];

      const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
      const freshRules = newRules.filter((r) => currentHashes.has(r.lessonHash));
      const pruned = newRules.length - freshRules.length;
      if (pruned > 0) {
        log.dim(TAG, `Pruned ${pruned} stale rules (lessons edited or removed)`); // totem-ignore
      }
      newRules.length = 0;
      newRules.push(...freshRules);

      const deps: CompileLessonDeps = {
        extractManualPattern,
        validateRegex,
        parseCompilerResponse,
        sanitizeFileGlobs,
        engineFields,
        runOrchestrator,
        log,
        existingByHash,
        options,
        config,
        cwd,
      };

      for (const lesson of toCompile) {
        const result = await compileLesson(lesson, deps);

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

      if (!options.raw) {
        // Prune stale non-compilable hashes (lesson was edited or removed)
        const freshNonCompilable = [...nonCompilableSet].filter((h) => currentHashes.has(h));
        saveCompiledRulesFile(rulesPath, {
          version: 1,
          rules: newRules,
          nonCompilable: freshNonCompilable,
        });
        log.info(
          TAG,
          `Results: ${compiled} compiled, ${skipped} skipped (conceptual), ${failed} failed, ${freshNonCompilable.length} cached`,
        );
        log.success(
          TAG,
          `${newRules.length} total rules saved to ${config.totemDir}/${COMPILED_RULES_FILE}`,
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
