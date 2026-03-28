import { describe, expect, it } from 'vitest';

import type { ParsedLesson } from './drift-detector.js';
import { validateLessons } from './lesson-linter.js';

function makeParsedLesson(overrides: Partial<ParsedLesson> & { raw: string }): ParsedLesson {
  const heading = overrides.heading ?? 'Test lesson';
  return {
    index: 0,
    heading,
    tags: overrides.tags ?? ['test'],
    body: overrides.body ?? overrides.raw,
    raw: overrides.raw,
    sourcePath: overrides.sourcePath,
  };
}

describe('lesson-linter', () => {
  describe('heading length', () => {
    it('passes for heading at 60 chars', () => {
      const heading = 'a'.repeat(60);
      const result = validateLessons([
        makeParsedLesson({ heading, raw: `## Lesson — ${heading}\n\nSome body text.` }),
      ]);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('warns for heading over 60 chars', () => {
      const heading = 'a'.repeat(61);
      const result = validateLessons([
        makeParsedLesson({ heading, raw: `## Lesson — ${heading}\n\nSome body text.` }),
      ]);
      expect(result.valid).toBe(true); // warning, not error
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].field).toBe('heading');
    });
  });

  describe('Pipeline 2 (conversational) lessons', () => {
    it('skips validation for lessons without Pattern field', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Some conversational lesson\n\n**Tags:** architecture\n\nDo not do bad things.',
        }),
      ]);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('required Pipeline 1 fields', () => {
    it('errors when Engine is missing', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** \\bfoo\\b\n**Severity:** error',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.diagnostics.some((d) => d.field === 'Engine' && d.severity === 'error')).toBe(
        true,
      );
    });

    it('errors when Severity is missing', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** \\bfoo\\b\n**Engine:** regex',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.diagnostics.some((d) => d.field === 'Severity' && d.severity === 'error')).toBe(
        true,
      );
    });

    it('passes with all required fields', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** \\bfoo\\b\n**Engine:** regex\n**Scope:** **/*.ts\n**Severity:** warning',
        }),
      ]);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('engine validation', () => {
    it('errors for invalid engine', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** foo\n**Engine:** semgrep\n**Severity:** error',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(
        result.diagnostics.some((d) => d.field === 'Engine' && d.message.includes('semgrep')),
      ).toBe(true);
    });

    it('accepts ast-grep engine', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** console.log($ARG)\n**Engine:** ast-grep\n**Scope:** **/*.ts\n**Severity:** warning',
        }),
      ]);
      // ast-grep patterns don't go through regex validation
      const engineErrors = result.diagnostics.filter((d) => d.field === 'Engine');
      expect(engineErrors).toHaveLength(0);
    });
  });

  describe('severity validation', () => {
    it('errors for invalid severity', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** foo\n**Engine:** regex\n**Severity:** critical',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(
        result.diagnostics.some((d) => d.field === 'Severity' && d.message.includes('critical')),
      ).toBe(true);
    });
  });

  describe('regex validation', () => {
    it('errors for invalid regex pattern', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** \\b(unclosed\n**Engine:** regex\n**Scope:** **/*.ts\n**Severity:** error',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.field === 'Pattern' && d.message.includes('Invalid regex'),
        ),
      ).toBe(true);
    });

    it('passes for valid regex pattern', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** \\bconsole\\.log\\(\n**Engine:** regex\n**Scope:** **/*.ts\n**Severity:** warning',
        }),
      ]);
      expect(result.valid).toBe(true);
    });

    it('skips regex validation for ast engine', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** (call_expression function: (member_expression))\n**Engine:** ast\n**Scope:** **/*.ts\n**Severity:** warning',
        }),
      ]);
      // Should not error on the pattern even though it's not valid regex
      const patternErrors = result.diagnostics.filter(
        (d) => d.field === 'Pattern' && d.severity === 'error',
      );
      expect(patternErrors).toHaveLength(0);
    });
  });

  describe('scope glob validation', () => {
    it('errors for markdown-escaped underscores in scope', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** foo\n**Engine:** regex\n**Scope:** **/\\_.ts\n**Severity:** error',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(
        result.diagnostics.some(
          (d) => d.field === 'Scope' && d.message.includes('markdown-escaped'),
        ),
      ).toBe(true);
    });

    it('warns when Scope is missing', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** foo\n**Engine:** regex\n**Severity:** error',
        }),
      ]);
      // Missing scope is a warning, not an error
      const scopeWarns = result.diagnostics.filter(
        (d) => d.field === 'Scope' && d.severity === 'warning',
      );
      expect(scopeWarns).toHaveLength(1);
      expect(result.valid).toBe(true); // warnings don't block
    });

    it('passes for valid scope globs', () => {
      const result = validateLessons([
        makeParsedLesson({
          raw: '## Lesson — Test\n\n**Pattern:** foo\n**Engine:** regex\n**Scope:** **/*.ts, **/*.tsx, !**/*.test.ts\n**Severity:** warning',
        }),
      ]);
      const scopeDiags = result.diagnostics.filter((d) => d.field === 'Scope');
      expect(scopeDiags).toHaveLength(0);
    });
  });

  describe('multiple lessons', () => {
    it('aggregates diagnostics across lessons', () => {
      const result = validateLessons([
        makeParsedLesson({
          heading: 'Good lesson',
          raw: '## Lesson — Good lesson\n\n**Pattern:** foo\n**Engine:** regex\n**Scope:** **/*.ts\n**Severity:** warning',
        }),
        makeParsedLesson({
          heading: 'Bad lesson',
          raw: '## Lesson — Bad lesson\n\n**Pattern:** \\b(broken\n**Engine:** regex\n**Scope:** **/*.ts\n**Severity:** error',
        }),
      ]);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].lessonHeading).toBe('Bad lesson');
    });
  });
});
