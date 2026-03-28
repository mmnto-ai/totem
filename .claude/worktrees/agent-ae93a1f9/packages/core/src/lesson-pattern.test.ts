import { describe, expect, it } from 'vitest';

import { extractManualPattern } from './lesson-pattern.js';

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
