import { describe, expect, it } from 'vitest';

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

  it('throws TotemParseError on batch failure instead of returning empty arrays (fail-closed)', () => {
    const invalidRule = { rule: { kind: '!!!INVALID_NODE_KIND!!!' } };
    const content = 'const x = 1;\n';
    expect(() =>
      matchAstGrepPatternsBatch(content, '.ts', [
        { rule: invalidRule as never, addedLineNumbers: [1] },
      ]),
    ).toThrow(TotemParseError);
  });
});
