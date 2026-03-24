import { engineFields, sanitizeFileGlobs, validateRegex } from './compiler.js';
import type { CompiledRule, CompilerOutput } from './compiler-schema.js';
import { extractManualPattern } from './lesson-pattern.js';

// ─── Types ──────────────────────────────────────────

export interface LessonInput {
  index: number;
  heading: string;
  body: string;
  hash: string;
}

export type CompileLessonResult =
  | { status: 'compiled'; rule: CompiledRule }
  | { status: 'skipped'; hash: string }
  | { status: 'failed' }
  | { status: 'noop' };

export interface CompileLessonCallbacks {
  onWarn?: (heading: string, message: string) => void;
  onDim?: (heading: string, message: string) => void;
}

export interface CompileLessonDeps {
  parseCompilerResponse: (response: string) => CompilerOutput | null;
  runOrchestrator: (prompt: string) => Promise<string | undefined>;
  existingByHash: Map<string, CompiledRule>;
  callbacks?: CompileLessonCallbacks;
}

// ─── Rule builder (pure, no I/O) ────────────────────

/**
 * Build a CompiledRule from parsed compiler output.
 * Returns null if the output is missing required fields or has an invalid regex.
 */
export function buildCompiledRule(
  parsed: CompilerOutput,
  lesson: { hash: string; heading: string },
  existingByHash: Map<string, CompiledRule>,
): CompiledRule | null {
  if (!parsed.compilable) return null;

  const severity = parsed.severity ?? 'warning';
  const engine = parsed.engine ?? 'regex';
  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = parsed.fileGlobs ? sanitizeFileGlobs(parsed.fileGlobs) : undefined;
  const globsObj = sanitizedGlobs && sanitizedGlobs.length > 0 ? { fileGlobs: sanitizedGlobs } : {};

  if (engine === 'ast-grep') {
    if (!parsed.astGrepPattern || !parsed.message) return null;
    return {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'ast-grep',
      severity,
      ...engineFields('ast-grep', parsed.astGrepPattern),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...globsObj,
    };
  }

  if (engine === 'ast') {
    if (!parsed.astQuery || !parsed.message) return null;
    return {
      lessonHash: lesson.hash,
      lessonHeading: lesson.heading,
      message: parsed.message,
      engine: 'ast',
      severity,
      ...engineFields('ast', parsed.astQuery),
      compiledAt: now,
      createdAt: existing?.createdAt ?? now,
      ...globsObj,
    };
  }

  // Regex engine (default)
  if (!parsed.pattern || !parsed.message) return null;
  const validation = validateRegex(parsed.pattern);
  if (!validation.valid) return null;

  return {
    lessonHash: lesson.hash,
    lessonHeading: lesson.heading,
    message: parsed.message,
    engine: 'regex',
    severity,
    ...engineFields('regex', parsed.pattern),
    compiledAt: now,
    createdAt: existing?.createdAt ?? now,
    ...globsObj,
  };
}

// ─── Manual pattern builder ─────────────────────────

export interface BuildRuleResult {
  rule: CompiledRule | null;
  rejectReason?: string;
}

/**
 * Build a CompiledRule from a lesson's manually specified pattern.
 * Returns { rule, rejectReason } so callers can report why a pattern was rejected.
 */
export function buildManualRule(
  lesson: LessonInput,
  existingByHash: Map<string, CompiledRule>,
): BuildRuleResult {
  const manual = extractManualPattern(lesson.body);
  if (!manual) return { rule: null };

  if (manual.engine === 'regex') {
    const validation = validateRegex(manual.pattern);
    if (!validation.valid) {
      return { rule: null, rejectReason: `Manual pattern rejected: ${validation.reason}` };
    }
  }

  const now = new Date().toISOString();
  const existing = existingByHash.get(lesson.hash);
  const sanitizedGlobs = manual.fileGlobs ? sanitizeFileGlobs(manual.fileGlobs) : undefined;

  return {
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

// ─── Single-lesson compilation ──────────────────────

/**
 * Compile a single lesson into a rule.
 * Handles both manual patterns (zero LLM) and LLM-compiled patterns.
 * Pure business logic — no UI, no I/O, no process.exit.
 */
export async function compileLesson(
  lesson: LessonInput,
  compilerPrompt: string,
  deps: CompileLessonDeps,
): Promise<CompileLessonResult> {
  const { parseCompilerResponse, runOrchestrator, existingByHash, callbacks } = deps;

  // ── Pipeline 1: Manual pattern (zero LLM) ────────
  const manualResult = buildManualRule(lesson, existingByHash);
  if (manualResult.rule) return { status: 'compiled', rule: manualResult.rule };
  if (manualResult.rejectReason) {
    callbacks?.onWarn?.(lesson.heading, manualResult.rejectReason);
    return { status: 'failed' };
  }
  // manualResult.rule === null && no rejectReason → no manual pattern, proceed to LLM

  // ── Pipeline 2: LLM compilation ──────────────────
  const prompt = `${compilerPrompt}\n\n## Lesson to Compile\n\nHeading: ${lesson.heading}\n\n${lesson.body}`;
  const response = await runOrchestrator(prompt);

  if (response == null) return { status: 'noop' };

  const parsed = parseCompilerResponse(response);
  if (!parsed) {
    callbacks?.onWarn?.(lesson.heading, 'Failed to parse LLM response — skipping');
    return { status: 'failed' };
  }

  if (!parsed.compilable) {
    callbacks?.onDim?.(lesson.heading, 'Not compilable (conceptual/architectural) — skipping');
    return { status: 'skipped', hash: lesson.hash };
  }

  const rule = buildCompiledRule(parsed, lesson, existingByHash);
  if (!rule) {
    // Provide specific rejection reason
    const engine = parsed.engine ?? 'regex';
    if (engine === 'regex' && parsed.pattern) {
      const validation = validateRegex(parsed.pattern);
      if (!validation.valid) {
        callbacks?.onWarn?.(lesson.heading, `Rejected regex: ${validation.reason} — skipping`);
        return { status: 'failed' };
      }
    }
    callbacks?.onWarn?.(lesson.heading, `Missing ${engine} fields or invalid pattern — skipping`);
    return { status: 'failed' };
  }

  return { status: 'compiled', rule };
}
