import { describe, expect, it } from 'vitest';

import {
  buildCorpusDispositionsQuery,
  CorpusDispositionSourceAdapter,
  mapDispositionThreads,
} from './spine-corpus-disposition-source.js';
import type { GhExec } from './spine-review-thread-source.js';

const OWNER = 'mmnto-ai';
const NAME = 'liquid-city';
const MERGE_OID = 'a'.repeat(40);

interface ThreadOpt {
  id?: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  path?: string;
  line?: number | null;
  originalLine?: number | null;
  comments?: Array<{
    databaseId?: number | null;
    diffHunk?: string | null;
    login: string | null;
    body: string;
  }>;
  commentsHasNext?: boolean;
}

function gqlThread(t: ThreadOpt) {
  return {
    id: t.id ?? 'PRRT_1',
    isResolved: t.isResolved ?? false,
    isOutdated: t.isOutdated ?? false,
    path: t.path ?? 'src/a.ts',
    line: t.line === undefined ? 40 : t.line,
    originalLine: t.originalLine === undefined ? 38 : t.originalLine,
    comments: {
      pageInfo: { hasNextPage: t.commentsHasNext ?? false },
      nodes: (t.comments ?? [{ login: 'jane', body: 'a note' }]).map((c) => ({
        databaseId: c.databaseId === undefined ? 1001 : c.databaseId,
        diffHunk: c.diffHunk === undefined ? '@@ -1 +1 @@\n+x' : c.diffHunk,
        author: c.login === null ? null : { login: c.login },
        body: c.body,
      })),
    },
  };
}

function okPayload(opts?: {
  mergeOid?: string | null;
  threads?: ThreadOpt[];
  threadsHasNext?: boolean;
}): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          mergeCommit: opts?.mergeOid === null ? null : { oid: opts?.mergeOid ?? MERGE_OID },
          reviewThreads: {
            pageInfo: { hasNextPage: opts?.threadsHasNext ?? false },
            nodes: (opts?.threads ?? []).map(gqlThread),
          },
        },
      },
    },
  });
}

function stubExec(payload: string): GhExec & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((_command: string, args: string[]) => {
    calls.push(args);
    return payload;
  }) as GhExec & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

describe('buildCorpusDispositionsQuery', () => {
  it('REQUESTS the span anchors + audit ids that the mining query lacks', () => {
    const q = buildCorpusDispositionsQuery(OWNER, NAME, 42);
    for (const field of ['diffHunk', 'line', 'originalLine', 'databaseId', 'id']) {
      expect(q).toContain(field);
    }
  });

  it('does NOT add an isResolved:false server filter (surface, don’t filter)', () => {
    const q = buildCorpusDispositionsQuery(OWNER, NAME, 42);
    expect(q).toContain('isResolved');
    expect(q).not.toMatch(/isResolved\s*:/); // no argument form
  });
});

describe('mapDispositionThreads', () => {
  it('lifts the root comment diffHunk to the thread span + preserves ids/flags', () => {
    const [mapped] = mapDispositionThreads([
      gqlThread({
        id: 'PRRT_9',
        isResolved: true,
        isOutdated: false,
        path: 'src/foo.ts',
        line: 12,
        originalLine: 10,
        comments: [
          {
            databaseId: 7,
            diffHunk: '@@ root @@\n+rootline',
            login: 'coderabbitai[bot]',
            body: 'finding',
          },
          { databaseId: 8, diffHunk: '@@ reply @@', login: 'jane', body: 'fixed' },
        ],
      }),
    ]);
    expect(mapped).toEqual({
      threadId: 'PRRT_9',
      path: 'src/foo.ts',
      line: 12,
      originalLine: 10,
      diffHunk: '@@ root @@\n+rootline',
      isResolved: true,
      isOutdated: false,
      comments: [
        { commentId: 7, author: 'coderabbitai[bot]', body: 'finding' },
        { commentId: 8, author: 'jane', body: 'fixed' },
      ],
    });
  });

  it('coerces a null author to "" and omits a null commentId / empty hunk', () => {
    const [mapped] = mapDispositionThreads([
      gqlThread({
        line: null,
        originalLine: null,
        comments: [{ databaseId: null, diffHunk: null, login: null, body: 'x' }],
      }),
    ]);
    expect(mapped?.diffHunk).toBe('');
    expect(mapped?.line).toBeNull();
    expect(mapped?.comments[0]).toEqual({ author: '', body: 'x' });
  });
});

describe('CorpusDispositionSourceAdapter.fetch', () => {
  it('CI hard-gate: throws on a live fetch in CI without ALLOW_LIVE_FETCH', async () => {
    const adapter = new CorpusDispositionSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload()),
      env: { CI: '1' },
    });
    await expect(adapter.fetch(42)).rejects.toThrow(/CI context/i);
  });

  it('CI hard-gate: ALLOW_LIVE_FETCH escapes the gate', async () => {
    const adapter = new CorpusDispositionSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ threads: [{}] })),
      env: { CI: '1', ALLOW_LIVE_FETCH: '1' },
    });
    const res = await adapter.fetch(42);
    expect(res.pr).toBe(42);
    expect(res.threads).toHaveLength(1);
  });

  it('maps a held-out PR to a span-anchored CorpusDisposition', async () => {
    const adapter = new CorpusDispositionSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ threads: [{ path: 'src/z.ts' }] })),
      env: {},
    });
    const res = await adapter.fetch(7);
    expect(res).toMatchObject({ pr: 7, mergeCommitSha: MERGE_OID });
    expect(res.threads[0]?.path).toBe('src/z.ts');
  });

  it('fails loud on a paginated thread set (no silent shrink)', async () => {
    const adapter = new CorpusDispositionSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ threads: [{}], threadsHasNext: true })),
      env: {},
    });
    await expect(adapter.fetch(7)).rejects.toThrow(/pagination unsupported/i);
  });

  it('fails loud when a held-out PR has no merge commit', async () => {
    const adapter = new CorpusDispositionSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ mergeOid: null })),
      env: {},
    });
    await expect(adapter.fetch(7)).rejects.toThrow(/no merge commit/i);
  });
});
