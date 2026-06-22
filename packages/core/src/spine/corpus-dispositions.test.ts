import { describe, expect, it } from 'vitest';

import {
  type CorpusDisposition,
  CorpusDispositionSchema,
  CorpusDispositionsSchema,
} from './corpus-dispositions.js';

const SHA = 'a'.repeat(40);

const valid: CorpusDisposition = {
  pr: 42,
  mergeCommitSha: SHA,
  threads: [
    {
      threadId: 'PRRT_kwDO',
      path: 'src/foo.ts',
      line: 40,
      originalLine: 38,
      diffHunk: '@@ -36,6 +36,8 @@\n+  const x = foo.bar;',
      isResolved: true,
      isOutdated: false,
      comments: [
        { commentId: 1001, author: 'coderabbitai[bot]', body: 'Possible null deref.' },
        { author: 'satur8d', body: 'Fixed.' },
      ],
    },
  ],
};

describe('CorpusDispositionSchema', () => {
  it('parses a fully-populated disposition', () => {
    expect(CorpusDispositionSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a thread with no span hints (line/originalLine absent or null)', () => {
    const noHints: CorpusDisposition = {
      pr: 7,
      mergeCommitSha: SHA,
      threads: [
        {
          path: 'src/a.ts',
          line: null,
          diffHunk: '@@ -1 +1 @@\n+x',
          isResolved: false,
          isOutdated: true,
          comments: [{ author: 'x', body: 'by design' }],
        },
      ],
    };
    expect(CorpusDispositionSchema.parse(noHints)).toEqual(noHints);
  });

  it('rejects a non-40-hex mergeCommitSha', () => {
    expect(() => CorpusDispositionSchema.parse({ ...valid, mergeCommitSha: 'abc' })).toThrow(
      /40-hex SHA/,
    );
  });

  it('rejects a non-positive pr', () => {
    expect(() => CorpusDispositionSchema.parse({ ...valid, pr: 0 })).toThrow();
  });

  it('parses an array payload (the frozen corpus-dispositions.json shape)', () => {
    expect(CorpusDispositionsSchema.parse([valid])).toHaveLength(1);
    expect(CorpusDispositionsSchema.parse([])).toEqual([]);
  });
});
