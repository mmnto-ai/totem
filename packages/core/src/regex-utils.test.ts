import { describe, expect, it } from 'vitest';

import { codeToPattern, escapeRegex } from './regex-utils.js';

describe('escapeRegex', () => {
  it('escapes all regex metacharacters', () => {
    const metacharacters = '.*+?^${}()|[]\\';
    const escaped = escapeRegex(metacharacters);
    expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    // The escaped string should be safe to use in a RegExp
    expect(() => new RegExp(escaped)).not.toThrow();
  });

  it('leaves alphanumeric strings unchanged', () => {
    expect(escapeRegex('hello123')).toBe('hello123');
    expect(escapeRegex('FooBar')).toBe('FooBar');
  });

  it('handles empty string', () => {
    expect(escapeRegex('')).toBe('');
  });
});

describe('codeToPattern', () => {
  it('escapes special characters and normalizes whitespace', () => {
    const code = '  function test(a, b) {';
    const pattern = codeToPattern(code);
    // Parens and braces should be escaped
    expect(pattern).toContain('\\(');
    expect(pattern).toContain('\\)');
    expect(pattern).toContain('\\{');
    // Whitespace runs should become \s+
    expect(pattern).toContain('\\s+');
    // Should not contain literal spaces
    expect(pattern).not.toContain('  ');
  });

  it('handles multi-line code', () => {
    const code = 'if (x) {\n  return y;\n}';
    const pattern = codeToPattern(code);
    // Should produce a valid regex
    expect(() => new RegExp(pattern)).not.toThrow();
    // Newlines and surrounding spaces should become \s+
    expect(pattern).toContain('\\s+');
  });

  it('trims blank leading and trailing lines', () => {
    const code = '\n\n  const x = 1;\n\n';
    const pattern = codeToPattern(code);
    // Should not start or end with \s+
    expect(pattern).not.toMatch(/^\\s\+/);
    expect(pattern).not.toMatch(/\\s\+$/);
    // Should contain the core content
    expect(pattern).toContain('const');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(codeToPattern('')).toBe('');
    expect(codeToPattern('   ')).toBe('');
    expect(codeToPattern('\n\n\n')).toBe('');
    expect(codeToPattern('  \t \n  ')).toBe('');
  });

  it('generated pattern actually matches the original code', () => {
    const code = 'const result = foo(bar, baz);';
    const pattern = codeToPattern(code);
    const re = new RegExp(pattern);
    expect(re.test(code)).toBe(true);
  });

  it('generated pattern matches reformatted version', () => {
    const code = 'const  x = 1';
    const pattern = codeToPattern(code);
    const re = new RegExp(pattern);
    // Original (double space)
    expect(re.test('const  x = 1')).toBe(true);
    // Reformatted (single space)
    expect(re.test('const x = 1')).toBe(true);
    // Extra spaces
    expect(re.test('const    x   =   1')).toBe(true);
  });
});
