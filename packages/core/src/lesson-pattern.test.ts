import { describe, expect, it } from 'vitest';

import {
  extractAllFields,
  extractBadGoodSnippets,
  extractManualPattern,
  extractRuleExamples,
  stripInlineCode,
} from './lesson-pattern.js';

describe('extractManualPattern', () => {
  it('extracts all fields from a well-formed lesson body', () => {
    const body = [
      '**Tags:** config, env',
      '**Pattern:** process\\.env\\[',
      '**Engine:** regex',
      '**Scope:** src/**/*.ts, !src/**/config.ts',
      '**Severity:** warning',
      '',
      'Use a validated config schema instead of direct env var access.',
    ].join('\n');

    const result = extractManualPattern(body);
    expect(result).toEqual({
      pattern: 'process\\.env\\[',
      engine: 'regex',
      fileGlobs: ['src/**/*.ts', '!src/**/config.ts'],
      severity: 'warning',
    });
  });

  it('returns null when no Pattern field is present', () => {
    const body = 'Just a normal lesson body without pattern fields.';
    expect(extractManualPattern(body)).toBeNull();
  });

  it('defaults engine to regex when not specified', () => {
    const body = '**Pattern:** console\\.log\\(';
    const result = extractManualPattern(body);
    expect(result?.engine).toBe('regex');
  });

  it('defaults severity to warning when not specified', () => {
    const body = '**Pattern:** console\\.log\\(';
    const result = extractManualPattern(body);
    expect(result?.severity).toBe('warning');
  });

  it('parses ast-grep engine', () => {
    const body = '**Pattern:** new Error($$$)\n**Engine:** ast-grep';
    const result = extractManualPattern(body);
    expect(result?.engine).toBe('ast-grep');
    expect(result?.pattern).toBe('new Error($$$)');
  });

  it('parses error severity', () => {
    const body = '**Pattern:** throw\\s+new\\s+Error\n**Severity:** error';
    const result = extractManualPattern(body);
    expect(result?.severity).toBe('error');
  });

  it('handles fields without bold markers', () => {
    const body = 'Pattern: process\\.env\\[\nEngine: regex\nSeverity: warning';
    const result = extractManualPattern(body);
    expect(result?.pattern).toBe('process\\.env\\[');
    expect(result?.engine).toBe('regex');
  });

  it('returns undefined fileGlobs when no Scope field', () => {
    const body = '**Pattern:** foo\\.bar';
    const result = extractManualPattern(body);
    expect(result?.fileGlobs).toBeUndefined();
  });
});

describe('extractAllFields', () => {
  it('returns all matching fields in order', () => {
    const body = '**Example Hit:** `foo()`\n**Example Hit:** `bar()`\n**Example Miss:** `baz()`';
    expect(extractAllFields(body, 'Example Hit')).toEqual(['`foo()`', '`bar()`']);
  });

  it('returns empty array when no matches', () => {
    expect(extractAllFields('no examples here', 'Example Hit')).toEqual([]);
  });

  it('handles non-bold syntax', () => {
    const body = 'Example Hit: hit1\nExample Hit: hit2';
    expect(extractAllFields(body, 'Example Hit')).toEqual(['hit1', 'hit2']);
  });

  it('captures empty values for bare field declarations', () => {
    const body = '**Example Hit:**\n**Example Hit:** valid';
    expect(extractAllFields(body, 'Example Hit')).toEqual(['', 'valid']);
  });
});

describe('stripInlineCode', () => {
  it('strips surrounding backticks', () => {
    expect(stripInlineCode('`console.log()`')).toBe('console.log()');
  });

  it('leaves non-backtick text unchanged', () => {
    expect(stripInlineCode('console.log()')).toBe('console.log()');
  });

  it('does not strip partial backticks', () => {
    expect(stripInlineCode('`partial')).toBe('`partial');
  });
});

describe('extractRuleExamples', () => {
  it('returns hits and misses with backticks stripped', () => {
    const body = '**Example Hit:** `console.log("bad")`\n**Example Miss:** `logger.info("good")`';
    const result = extractRuleExamples(body);
    expect(result).toEqual({
      hits: ['console.log("bad")'],
      misses: ['logger.info("good")'],
    });
  });

  it('returns null when no examples exist', () => {
    expect(extractRuleExamples('plain body')).toBeNull();
  });

  it('handles multiple hits and zero misses', () => {
    const body = '**Example Hit:** a\n**Example Hit:** b';
    const result = extractRuleExamples(body);
    expect(result!.hits).toEqual(['a', 'b']);
    expect(result!.misses).toEqual([]);
  });
});

describe('extractBadGoodSnippets', () => {
  it('extracts fenced code blocks', () => {
    const body = [
      '**Bad:**',
      '```ts',
      'console.log("bad");',
      '```',
      '',
      '**Good:**',
      '```ts',
      'logger.info("good");',
      '```',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad");']);
    expect(result!.good).toEqual(['logger.info("good");']);
  });

  it('extracts inline single-line snippets', () => {
    const body = '**Bad:** `console.log("bad")`\n**Good:** `logger.info("good")`';
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad")']);
    expect(result!.good).toEqual(['logger.info("good")']);
  });

  it('returns null when no Bad/Good fields', () => {
    const body = 'Just a normal lesson body without pattern fields.';
    expect(extractBadGoodSnippets(body)).toBeNull();
  });

  it('returns null when only Bad (no Good)', () => {
    const body = '**Bad:** `console.log("bad")`';
    expect(extractBadGoodSnippets(body)).toBeNull();
  });

  it('returns null when only Good (no Bad)', () => {
    const body = '**Good:** `logger.info("good")`';
    expect(extractBadGoodSnippets(body)).toBeNull();
  });

  it('handles mixed formats (fenced Bad, inline Good)', () => {
    const body = [
      '**Bad:**',
      '```ts',
      'console.log("bad");',
      '```',
      '**Good:** `logger.info("good")`',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad");']);
    expect(result!.good).toEqual(['logger.info("good")']);
  });

  it('filters empty lines from fenced snippets', () => {
    const body = [
      '**Bad:**',
      '```ts',
      '',
      'console.log("bad");',
      '',
      '```',
      '**Good:**',
      '```ts',
      '',
      'logger.info("good");',
      '',
      '```',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad");']);
    expect(result!.good).toEqual(['logger.info("good");']);
  });

  it('extracts multi-line fenced code blocks', () => {
    const body = [
      '**Bad:**',
      '```ts',
      'const x = 1;',
      'console.log(x);',
      '```',
      '',
      '**Good:**',
      '```ts',
      'const x = 1;',
      'logger.info(x);',
      '```',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['const x = 1;', 'console.log(x);']);
    expect(result!.good).toEqual(['const x = 1;', 'logger.info(x);']);
  });
});
