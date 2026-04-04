import { describe, expect, it } from 'vitest';

import { parseEslintConfig } from './eslint-adapter.js';

describe('parseEslintConfig', () => {
  it('parses no-restricted-imports with paths', () => {
    const config = JSON.stringify({
      rules: {
        'no-restricted-imports': ['error', { paths: ['lodash', 'underscore'] }],
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]!.lessonHeading).toBe('[eslint] no-restricted-imports: lodash');
    expect(result.rules[0]!.pattern).toContain('lodash');
    expect(result.rules[0]!.severity).toBe('error');
    expect(result.rules[1]!.lessonHeading).toContain('underscore');
  });

  it('parses no-restricted-imports with patterns', () => {
    const config = JSON.stringify({
      rules: {
        'no-restricted-imports': ['warn', { patterns: ['internal/*'] }],
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.pattern).toContain('internal');
    expect(result.rules[0]!.severity).toBe('warning');
  });

  it('parses no-restricted-globals', () => {
    const config = JSON.stringify({
      rules: {
        'no-restricted-globals': ['error', 'event', 'fdescribe'],
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]!.lessonHeading).toContain('event');
    expect(result.rules[0]!.pattern).toBe('\\bevent\\b');
    expect(result.rules[1]!.pattern).toBe('\\bfdescribe\\b');
  });

  it('maps numeric severity', () => {
    const config = JSON.stringify({
      rules: {
        'no-restricted-globals': [2, 'badGlobal'],
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules[0]!.severity).toBe('error');
  });

  it('skips rules set to off', () => {
    const config = JSON.stringify({
      rules: {
        'no-restricted-imports': 'off',
        'no-restricted-globals': 0,
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules).toHaveLength(0);
  });

  it('skips non-importable rules and reports them', () => {
    const config = JSON.stringify({
      rules: {
        'no-console': 'error',
        'no-debugger': 'warn',
        'no-restricted-imports': ['error', { paths: ['bad-lib'] }],
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules).toHaveLength(1); // only restricted-imports
    expect(result.skipped).toHaveLength(2); // no-console, no-debugger
    expect(result.skipped[0]!.reason).toContain('Not an importable rule');
  });

  it('handles invalid JSON gracefully', () => {
    const result = parseEslintConfig('{{{not json');
    expect(result.rules).toHaveLength(0);
    expect(result.skipped[0]!.reason).toContain('Invalid JSON');
  });

  it('handles missing rules object', () => {
    const result = parseEslintConfig('{"extends": "eslint:recommended"}');
    expect(result.rules).toHaveLength(0);
    expect(result.skipped[0]!.reason).toContain('No "rules" object');
  });

  it('produces deterministic lessonHash', () => {
    const config = JSON.stringify({
      rules: { 'no-restricted-globals': ['error', 'test'] },
    });
    const r1 = parseEslintConfig(config);
    const r2 = parseEslintConfig(config);
    expect(r1.rules[0]!.lessonHash).toBe(r2.rules[0]!.lessonHash);
  });

  it('handles @typescript-eslint/no-restricted-imports', () => {
    const config = JSON.stringify({
      rules: {
        '@typescript-eslint/no-restricted-imports': ['error', { paths: ['moment'] }],
      },
    });
    const result = parseEslintConfig(config);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.lessonHeading).toContain('moment');
  });

  it('sets JS/TS file globs on all rules', () => {
    const config = JSON.stringify({
      rules: { 'no-restricted-globals': ['error', 'x'] },
    });
    const result = parseEslintConfig(config);
    const globs = result.rules[0]!.fileGlobs!;
    expect(globs).toContain('**/*.ts');
    expect(globs).toContain('**/*.js');
  });

  describe('no-restricted-properties', () => {
    it('imports object.property pair as ast-grep rule', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': [
              'error',
              { object: 'Math', property: 'pow', message: 'Use ** operator' },
            ],
          },
        }),
      );
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.lessonHeading).toContain('Math.pow');
      expect(result.rules[0]!.message).toBe('Use ** operator');
      expect(result.rules[0]!.engine).toBe('ast-grep');
      expect(result.rules[0]!.astGrepPattern).toBe('Math.pow');
      expect(result.rules[0]!.pattern).toBe('');
    });

    it('imports property-only restriction as regex rule', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': ['warn', { property: '__defineGetter__' }],
          },
        }),
      );
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.severity).toBe('warning');
      expect(result.rules[0]!.engine).toBe('regex');
      expect(result.rules[0]!.pattern).toContain('__defineGetter__');
    });

    it('imports object-only restriction as ast-grep rule', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': ['error', { object: 'arguments' }],
          },
        }),
      );
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.engine).toBe('ast-grep');
      expect(result.rules[0]!.astGrepPattern).toBe('arguments.$PROP');
      expect(result.rules[0]!.pattern).toBe('');
    });

    it('generates fallback message when none provided', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': ['error', { object: 'Math', property: 'pow' }],
          },
        }),
      );
      expect(result.rules[0]!.message).toContain('restricted');
    });

    it('skips entries with neither object nor property', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': ['error', { message: 'orphan' }],
          },
        }),
      );
      expect(result.rules).toHaveLength(0);
    });

    it('handles empty config', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: { 'no-restricted-properties': 'error' },
        }),
      );
      expect(result.rules).toHaveLength(0);
    });
  });

  describe('no-restricted-syntax', () => {
    it('imports known node types', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-syntax': ['error', 'ForInStatement', 'WithStatement'],
          },
        }),
      );
      expect(result.rules).toHaveLength(2);
      expect(result.rules[0]!.lessonHeading).toContain('ForInStatement');
      expect(result.rules[1]!.lessonHeading).toContain('WithStatement');
    });

    it('handles mixed string and object selectors', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-syntax': [
              'error',
              'DebuggerStatement',
              { selector: 'WithStatement', message: 'with is deprecated' },
            ],
          },
        }),
      );
      expect(result.rules).toHaveLength(2);
      expect(result.rules[0]!.message).toContain('DebuggerStatement');
      expect(result.rules[1]!.message).toBe('with is deprecated');
    });

    it('skips unknown/complex selectors', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-syntax': [
              'error',
              'CallExpression[callee.name="eval"]',
              'ForInStatement',
            ],
          },
        }),
      );
      // Only ForInStatement maps, the complex selector is skipped
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0]!.lessonHeading).toContain('ForInStatement');
    });

    it('handles empty config', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: { 'no-restricted-syntax': 'error' },
        }),
      );
      expect(result.rules).toHaveLength(0);
    });

    it('generates regex that matches expected code', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: { 'no-restricted-syntax': ['error', 'DebuggerStatement'] },
        }),
      );
      const re = new RegExp(result.rules[0]!.pattern);
      expect(re.test('  debugger;')).toBe(true);
      expect(re.test('const x = 1;')).toBe(false);
    });
  });

  describe('no-restricted-properties bracket notation', () => {
    it('uses ast-grep for object+property (handles bracket notation natively)', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': ['error', { object: 'Math', property: 'pow' }],
          },
        }),
      );
      expect(result.rules[0]!.engine).toBe('ast-grep');
      expect(result.rules[0]!.astGrepPattern).toBe('Math.pow');
      // ast-grep natively matches dot, optional chaining, and bracket notation
    });

    it('matches bracket notation for property-only via regex', () => {
      const result = parseEslintConfig(
        JSON.stringify({
          rules: {
            'no-restricted-properties': ['error', { property: '__proto__' }],
          },
        }),
      );
      expect(result.rules[0]!.engine).toBe('regex');
      const re = new RegExp(result.rules[0]!.pattern);
      expect(re.test('obj.__proto__')).toBe(true);
      expect(re.test('obj?.__proto__')).toBe(true);
      expect(re.test('obj["__proto__"]')).toBe(true);
      expect(re.test("obj['__proto__']")).toBe(true);
      expect(re.test('const __proto__ = 1;')).toBe(false);
    });
  });
});
