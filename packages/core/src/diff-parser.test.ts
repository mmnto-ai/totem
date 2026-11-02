import { describe, expect, it } from 'vitest';

import { extractAddedLines } from './diff-parser.js';

// ─── Empty context lines inside a hunk (mmnto-ai/totem#3113) ────────────────
//
// Under `diff.suppressBlankEmpty` git prints an empty context line as an empty
// string instead of a single space, and no flag restores the space. The parser
// counts such a line as context, so the line numbers and the preceding-line
// lookup match the default form; an empty line OUTSIDE a hunk (the trailing
// element a split leaves after the final newline) is still ignored.

const HEADER = [
  'diff --git a/src/s.ts b/src/s.ts',
  'index 1111111..2222222 100644',
  '--- a/src/s.ts',
  '+++ b/src/s.ts',
  '@@ -1,2 +1,3 @@',
];

describe('extractAddedLines — empty context lines (mmnto-ai/totem#3113)', () => {
  it('counts an empty line inside a hunk as the context line git meant', () => {
    const spaced = [...HEADER, ' // totem-ignore-next-line', ' ', '+console.log(1);', ''].join(
      '\n',
    );
    const suppressed = [...HEADER, ' // totem-ignore-next-line', '', '+console.log(1);', ''].join(
      '\n',
    );
    const expected = [
      { file: 'src/s.ts', line: 'console.log(1);', lineNumber: 3, precedingLine: '' },
    ];
    expect(extractAddedLines(spaced)).toEqual(expected);
    expect(extractAddedLines(suppressed)).toEqual(expected);
  });

  it('a hunk header resets the count, so empty lines before the first hunk or between file blocks do not shift the numbers', () => {
    const diff = [
      '',
      ...HEADER,
      ' a',
      '+b',
      '',
      'diff --git a/t.ts b/t.ts',
      'index 3333333..4444444 100644',
      '--- a/t.ts',
      '+++ b/t.ts',
      '',
      '@@ -1 +1,2 @@',
      ' x',
      '+y',
    ].join('\n');
    expect(extractAddedLines(diff)).toEqual([
      { file: 'src/s.ts', line: 'b', lineNumber: 2, precedingLine: 'a' },
      { file: 't.ts', line: 'y', lineNumber: 2, precedingLine: 'x' },
    ]);
  });
});
