/**
 * Lesson file linter — validates Pipeline 1 metadata.
 * Catches formatting errors, malformed patterns, escaped globs,
 * and long headings before compilation.
 */

import { validateRegex } from './compiler.js';
import type { ParsedLesson } from './drift-detector.js';
import { HEADING_MAX_CHARS } from './lesson-format.js';
import { extractAllFields, extractField, stripInlineCode } from './lesson-pattern.js';

export interface LessonLintDiagnostic {
  lessonHeading: string;
  sourcePath?: string;
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface LessonLintResult {
  valid: boolean;
  diagnostics: LessonLintDiagnostic[];
}

const VALID_ENGINES = new Set(['regex', 'ast', 'ast-grep']);
const VALID_SEVERITIES = new Set(['error', 'warning']);
const ESCAPED_GLOB_RE = /\\_\.|(?<!\*)\\\*/;

function isPipeline1(body: string): boolean {
  return extractField(body, 'Pattern') != null;
}

function lintLesson(lesson: ParsedLesson): LessonLintDiagnostic[] {
  const diags: LessonLintDiagnostic[] = [];
  const base = { lessonHeading: lesson.heading, sourcePath: lesson.sourcePath };

  // ── Heading length ──
  if (lesson.heading.length > HEADING_MAX_CHARS) {
    diags.push({
      ...base,
      severity: 'warning',
      field: 'heading',
      message: `Heading is ${lesson.heading.length} chars (max ${HEADING_MAX_CHARS})`,
    });
  }

  // ── Example Hit/Miss validation (applies to ALL lessons) ──
  const body = lesson.raw;
  const exampleHits = extractAllFields(body, 'Example Hit');
  const exampleMisses = extractAllFields(body, 'Example Miss');

  for (const hit of exampleHits) {
    if (!stripInlineCode(hit).trim()) {
      diags.push({
        ...base,
        severity: 'error',
        field: 'Example Hit',
        message: 'Example Hit value is empty',
      });
    }
  }
  for (const miss of exampleMisses) {
    if (!stripInlineCode(miss).trim()) {
      diags.push({
        ...base,
        severity: 'error',
        field: 'Example Miss',
        message: 'Example Miss value is empty',
      });
    }
  }

  // Only apply Pipeline 1 checks if the lesson has a Pattern field
  if (!isPipeline1(body)) return diags;

  // ── Required fields ──
  // Pattern is guaranteed by isPipeline1 check above
  const pattern = extractField(body, 'Pattern')!;
  const engineRaw = extractField(body, 'Engine');
  const severityRaw = extractField(body, 'Severity');

  if (!engineRaw) {
    diags.push({
      ...base,
      severity: 'error',
      field: 'Engine',
      message: 'Missing **Engine:** field',
    });
  }

  if (!severityRaw) {
    diags.push({
      ...base,
      severity: 'error',
      field: 'Severity',
      message: 'Missing **Severity:** field',
    });
  }

  // ── Engine validation ──
  if (engineRaw && !VALID_ENGINES.has(engineRaw.toLowerCase())) {
    diags.push({
      ...base,
      severity: 'error',
      field: 'Engine',
      message: `Invalid engine "${engineRaw}". Must be one of: regex, ast, ast-grep`,
    });
  }

  // ── Severity validation ──
  if (severityRaw && !VALID_SEVERITIES.has(severityRaw.toLowerCase())) {
    diags.push({
      ...base,
      severity: 'error',
      field: 'Severity',
      message: `Invalid severity "${severityRaw}". Must be "error" or "warning"`,
    });
  }

  // ── Regex validation ──
  const engine = engineRaw?.toLowerCase();
  if (pattern && (engine === 'regex' || !engine)) {
    const result = validateRegex(pattern);
    if (!result.valid) {
      diags.push({
        ...base,
        severity: 'error',
        field: 'Pattern',
        message: `Invalid regex: ${result.reason}`,
      });
    }
  }

  // ── Scope glob validation ──
  const scopeRaw = extractField(body, 'Scope');
  if (scopeRaw) {
    if (ESCAPED_GLOB_RE.test(scopeRaw)) {
      diags.push({
        ...base,
        severity: 'error',
        field: 'Scope',
        message: 'Scope contains markdown-escaped characters (\\_ or \\*). Check .prettierignore.',
      });
    }
  } else {
    diags.push({
      ...base,
      severity: 'warning',
      field: 'Scope',
      message: 'Missing **Scope:** field — rule will match all files',
    });
  }

  // ── Engine vs examples ──
  if ((exampleHits.length > 0 || exampleMisses.length > 0) && engine && engine !== 'regex') {
    diags.push({
      ...base,
      severity: 'warning',
      field: 'Example Hit',
      message: 'Example Hit/Miss lines are only verified for regex-engine rules',
    });
  }

  return diags;
}

export function validateLessons(lessons: ParsedLesson[]): LessonLintResult {
  const diagnostics = lessons.flatMap(lintLesson);
  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  return {
    valid: !hasErrors,
    diagnostics,
  };
}
