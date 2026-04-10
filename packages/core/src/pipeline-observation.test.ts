import { describe, expect, it } from 'vitest';

import {
  deduplicateObservations,
  generateObservationRule,
  type ObservationInput,
} from './pipeline-observation.js';

const FIVE_LINE_FILE = [
  'import { foo } from "bar";',
  '',
  'const result = foo(42);',
  'console.log(result);',
  'export default result;',
].join('\n');

describe('generateObservationRule', () => {
  it('generates warning severity rule from extracted file content', () => {
    const input: ObservationInput = {
      file: 'src/example.ts',
      line: 3,
      message: 'Avoid magic numbers',
      fileContent: FIVE_LINE_FILE,
    };

    const rule = generateObservationRule(input);

    expect(rule).not.toBeNull();
    expect(rule!.severity).toBe('warning');
    expect(rule!.engine).toBe('regex');
    expect(rule!.pattern).toBeTruthy();
    // Pattern should match the original line
    const re = new RegExp(rule!.pattern);
    expect(re.test('const result = foo(42);')).toBe(true);
  });

  it('returns null for out-of-range line number', () => {
    const input: ObservationInput = {
      file: 'src/example.ts',
      line: 100,
      message: 'Some finding',
      fileContent: FIVE_LINE_FILE,
    };

    expect(generateObservationRule(input)).toBeNull();
  });

  it('returns null for empty/whitespace-only line', () => {
    const input: ObservationInput = {
      file: 'src/example.ts',
      line: 2, // The empty line in FIVE_LINE_FILE
      message: 'Some finding',
      fileContent: FIVE_LINE_FILE,
    };

    expect(generateObservationRule(input)).toBeNull();
  });

  it('derives fileGlobs from file extension', () => {
    const cases = [
      { file: 'src/app.ts', expected: '**/*.ts' },
      { file: 'lib/utils.py', expected: '**/*.py' },
      { file: 'cmd/main.go', expected: '**/*.go' },
      { file: 'src/App.jsx', expected: '**/*.jsx' },
    ];

    for (const { file, expected } of cases) {
      const input: ObservationInput = {
        file,
        line: 1,
        message: 'test',
        fileContent: 'import { foo } from "bar";',
      };

      const rule = generateObservationRule(input);
      expect(rule).not.toBeNull();
      expect(rule!.fileGlobs).toEqual([expected]);
    }
  });

  it('computes deterministic lessonHash from pattern', () => {
    const inputA: ObservationInput = {
      file: 'src/a.ts',
      line: 1,
      message: 'msg1',
      fileContent: 'const x = 1;',
    };

    const inputB: ObservationInput = {
      file: 'src/b.ts',
      line: 1,
      message: 'msg2',
      fileContent: 'const x = 1;', // Same content → same pattern → same hash
    };

    const inputC: ObservationInput = {
      file: 'src/c.ts',
      line: 1,
      message: 'msg3',
      fileContent: 'const y = 2;', // Different content → different hash
    };

    const ruleA = generateObservationRule(inputA)!;
    const ruleB = generateObservationRule(inputB)!;
    const ruleC = generateObservationRule(inputC)!;

    // Same pattern → same hash
    expect(ruleA.lessonHash).toBe(ruleB.lessonHash);
    // Different pattern → different hash
    expect(ruleA.lessonHash).not.toBe(ruleC.lessonHash);
    // Hash is 16 hex chars
    expect(ruleA.lessonHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generated pattern matches the original line', () => {
    const input: ObservationInput = {
      file: 'src/example.ts',
      line: 4,
      message: 'Avoid console.log',
      fileContent: FIVE_LINE_FILE,
    };

    const rule = generateObservationRule(input)!;
    const re = new RegExp(rule.pattern);
    expect(re.test('console.log(result);')).toBe(true);
  });

  it('rejects pure-punctuation lines like } or */ (#1279)', () => {
    const cases = [
      { content: '}', desc: 'closing brace' },
      { content: '*/', desc: 'block comment close' },
      { content: '});', desc: 'closing brace + paren + semi' },
      { content: '],', desc: 'closing bracket + comma' },
      { content: '};', desc: 'closing brace + semi' },
      { content: '  }  ', desc: 'indented closing brace' },
    ];

    for (const { content, desc } of cases) {
      const input: ObservationInput = {
        file: 'src/example.ts',
        line: 1,
        message: `Finding on ${desc}`,
        fileContent: content,
      };

      expect(generateObservationRule(input)).toBeNull();
    }
  });

  it('rejects comment-only lines (#1279)', () => {
    const cases = [
      '// TODO: fix this',
      '// same response cache key.',
      '/* eslint-disable */',
      '   // indented comment',
      '# Python comment',
      '#TODO no space after hash',
      '   # indented hash comment',
      ' * JSDoc continuation line',
      '   * indented JSDoc line',
    ];

    for (const content of cases) {
      const input: ObservationInput = {
        file: 'src/example.ts',
        line: 1,
        message: 'Finding on comment line',
        fileContent: content,
      };

      expect(generateObservationRule(input)).toBeNull();
    }
  });

  it('accepts valid code lines despite containing punctuation (#1279)', () => {
    const cases = [
      'const result = foo(42);',
      'import { foo } from "bar";',
      'export default result;',
      'console.log(result);',
      'if (x > 0) {',
      'return this.value;',
    ];

    for (const content of cases) {
      const input: ObservationInput = {
        file: 'src/example.ts',
        line: 1,
        message: 'Valid finding',
        fileContent: content,
      };

      expect(generateObservationRule(input)).not.toBeNull();
    }
  });

  it('severity is always warning, never error', () => {
    const input: ObservationInput = {
      file: 'src/example.ts',
      line: 1,
      message: 'CRITICAL: security vulnerability',
      fileContent: 'eval(userInput);',
    };

    const rule = generateObservationRule(input)!;
    // Even for critical findings, observation rules are always warnings (ADR-058)
    expect(rule.severity).toBe('warning');
    expect(rule.severity).not.toBe('error');
  });
});

describe('deduplicateObservations', () => {
  it('deduplicates rules with identical patterns', () => {
    const base: ObservationInput = {
      file: 'src/a.ts',
      line: 1,
      message: '',
      fileContent: 'const x = 1;',
    };

    const rule1 = generateObservationRule({ ...base, message: 'Finding A' })!;
    const rule2 = generateObservationRule({ ...base, message: 'Finding B' })!;
    const rule3 = generateObservationRule({ ...base, message: 'Finding C' })!;

    const result = deduplicateObservations([rule1, rule2, rule3]);

    expect(result).toHaveLength(1);
    // All unique messages should be merged
    expect(result[0].message).toContain('Finding A');
    expect(result[0].message).toContain('Finding B');
    expect(result[0].message).toContain('Finding C');
    expect(result[0].message).toBe('Finding A | Finding B | Finding C');
  });

  it('preserves distinct rules', () => {
    const ruleA = generateObservationRule({
      file: 'src/a.ts',
      line: 1,
      message: 'Finding A',
      fileContent: 'const x = 1;',
    })!;

    const ruleB = generateObservationRule({
      file: 'src/b.ts',
      line: 1,
      message: 'Finding B',
      fileContent: 'const y = 2;',
    })!;

    const result = deduplicateObservations([ruleA, ruleB]);

    expect(result).toHaveLength(2);
  });

  it('merges fileGlobs from different extensions', () => {
    const ruleTs = generateObservationRule({
      file: 'src/a.ts',
      line: 1,
      message: 'Finding in TS',
      fileContent: 'const x = 1;',
    })!;

    const ruleJs = generateObservationRule({
      file: 'src/b.js',
      line: 1,
      message: 'Finding in JS',
      fileContent: 'const x = 1;',
    })!;

    const result = deduplicateObservations([ruleTs, ruleJs]);

    expect(result).toHaveLength(1);
    expect(result[0]!.fileGlobs).toEqual(['**/*.js', '**/*.ts']);
    expect(result[0]!.message).toContain('Finding in TS');
    expect(result[0]!.message).toContain('Finding in JS');
  });
});
