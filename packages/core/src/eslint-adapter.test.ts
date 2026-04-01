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
});
