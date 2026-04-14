import { describe, expect, it } from 'vitest';

import type { AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPattern, matchAstGrepPatternsBatch } from './ast-grep-query.js';
import { TotemParseError } from './errors.js';

// ─── matchAstGrepPattern ─────────────────────────────

describe('matchAstGrepPattern', () => {
  it('matches a valid pattern against code', () => {
    const content = 'const x = 1;\nconsole.log(x);\nconst y = 2;\n';
    const matches = matchAstGrepPattern(content, '.ts', 'console.log($$$)', [2]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lineNumber).toBe(2);
  });

  it('returns empty array for unsupported extensions', () => {
    const matches = matchAstGrepPattern('x = 1', '.py', '$X = 1', [1]);
    expect(matches).toEqual([]);
  });

  it('returns empty array when no added lines overlap', () => {
    const content = 'console.log(1);\nconst x = 1;\n';
    const matches = matchAstGrepPattern(content, '.ts', 'console.log($$$)', [2]);
    expect(matches).toEqual([]);
  });

  it('throws TotemParseError on query engine failure instead of returning empty array (fail-closed)', () => {
    const invalidRule = { rule: { kind: '!!!INVALID_NODE_KIND!!!' } };
    const content = 'const x = 1;\n';
    expect(() => matchAstGrepPattern(content, '.ts', invalidRule as never, [1])).toThrow(
      TotemParseError,
    );
  });
});

// ─── matchAstGrepPatternsBatch ───────────────────────

describe('matchAstGrepPatternsBatch', () => {
  it('returns results for multiple patterns in one parse', () => {
    const content = 'console.log(1);\ndebugger;\nconst x = 1;\n';
    const results = matchAstGrepPatternsBatch(content, '.ts', [
      { rule: 'console.log($$$)', addedLineNumbers: [1] },
      { rule: 'debugger', addedLineNumbers: [2] },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]!).toHaveLength(1);
    expect(results[1]!).toHaveLength(1);
  });

  it('returns empty array for unsupported extensions', () => {
    const results = matchAstGrepPatternsBatch('x = 1', '.py', [
      { rule: '$X = 1', addedLineNumbers: [1] },
    ]);
    expect(results).toEqual([[]]);
  });

  it('throws TotemParseError on batch failure instead of returning empty arrays (fail-closed) when no onRuleFailure', () => {
    const invalidRule = { rule: { kind: '!!!INVALID_NODE_KIND!!!' } };
    const content = 'const x = 1;\n';
    expect(() =>
      matchAstGrepPatternsBatch(content, '.ts', [
        { rule: invalidRule as never, addedLineNumbers: [1] },
      ]),
    ).toThrow(TotemParseError);
  });

  // ─── Per-rule try/catch (mmnto/totem#1408 G-7) ────────
  //
  // One malformed compound rule inside a batch must not blast-radius the
  // rest of the file's ast-grep pass. When the caller supplies an
  // `onRuleFailure` sink, each findAll call gets its own try/catch; the
  // sink receives the failure and the batch continues. Without the sink,
  // legacy fail-closed behavior holds (the whole batch throws).
  describe('per-rule try/catch resilience', () => {
    it('emits onRuleFailure for a malformed rule and continues the batch', () => {
      const content = 'const x = 1;\nconsole.log(x);\n';
      const invalidRule = { rule: { kind: '!!!INVALID_NODE_KIND!!!' } } as unknown as AstGrepRule;

      const failures: Array<{ index: number; message: string }> = [];
      const results = matchAstGrepPatternsBatch(
        content,
        '.ts',
        [
          { rule: invalidRule, addedLineNumbers: [1] },
          { rule: 'console.log($$$)', addedLineNumbers: [2] },
        ],
        (index, err) => {
          failures.push({ index, message: err.message });
        },
      );

      expect(failures).toHaveLength(1);
      expect(failures[0]!.index).toBe(0);
      expect(failures[0]!.message.length).toBeGreaterThan(0);
      // Second rule (valid) must still produce a match
      expect(results).toHaveLength(2);
      expect(results[0]!).toEqual([]);
      expect(results[1]!).toHaveLength(1);
      expect(results[1]![0]!.lineNumber).toBe(2);
    });

    it('routes a valid subsequent rule to results even when an earlier rule throws', () => {
      const content = 'debugger;\nconsole.log(1);\n';
      const invalidRule = { rule: { kind: '!!!INVALID_KIND!!!' } } as unknown as AstGrepRule;

      const failures: number[] = [];
      const results = matchAstGrepPatternsBatch(
        content,
        '.ts',
        [
          { rule: 'debugger', addedLineNumbers: [1] },
          { rule: invalidRule, addedLineNumbers: [2] },
          { rule: 'console.log($$$)', addedLineNumbers: [2] },
        ],
        (index) => {
          failures.push(index);
        },
      );

      expect(failures).toEqual([1]);
      expect(results[0]!).toHaveLength(1);
      expect(results[1]!).toEqual([]);
      expect(results[2]!).toHaveLength(1);
    });
  });
});
