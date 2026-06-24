import { describe, expect, it } from 'vitest';

import { classifyAuthorKind, normalizeReviewChrome } from '@mmnto/totem';

import {
  buildReviewThreadsQuery,
  type CommentEnrichers,
  type GhExec,
  mapThreads,
  ReviewThreadSourceAdapter,
} from './spine-review-thread-source.js';

// ─── Helpers ─────────────────────────────────────────

const OWNER = 'mmnto-ai';
const NAME = 'totem';
const MERGE_OID = 'a'.repeat(40);

/** The real core enrichers (slice β) — tests exercise the shipped classification. */
const enrich: CommentEnrichers = { classifyAuthorKind, normalizeReviewChrome };

/** A well-formed GraphQL response payload (string, as `gh` returns). */
function okPayload(opts?: {
  mergeOid?: string | null;
  threads?: Array<{
    isResolved?: boolean;
    isOutdated?: boolean;
    path?: string;
    comments?: Array<{ login: string | null; body: string }>;
    commentsHasNext?: boolean;
  }>;
  threadsHasNext?: boolean;
}): string {
  const threads = (opts?.threads ?? []).map((t) => ({
    isResolved: t.isResolved ?? false,
    isOutdated: t.isOutdated ?? false,
    path: t.path ?? 'packages/core/src/x.ts',
    comments: {
      pageInfo: { hasNextPage: t.commentsHasNext ?? false },
      nodes: (t.comments ?? [{ login: 'jane', body: 'a note' }]).map((c) => ({
        author: c.login === null ? null : { login: c.login },
        body: c.body,
      })),
    },
  }));
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          mergeCommit: opts?.mergeOid === null ? null : { oid: opts?.mergeOid ?? MERGE_OID },
          reviewThreads: {
            pageInfo: { hasNextPage: opts?.threadsHasNext ?? false },
            nodes: threads,
          },
        },
      },
    },
  });
}

/** An exec stub that records the args it was called with and returns a fixed payload. */
function stubExec(payload: string): GhExec & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((_command: string, args: string[]) => {
    calls.push(args);
    return payload;
  }) as GhExec & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

// ─── Query construction (the reframed agy fold-2: query-spy) ─────────────────

describe('buildReviewThreadsQuery', () => {
  it('REQUESTS isResolved and isOutdated on reviewThreads (so core has the signal)', () => {
    const q = buildReviewThreadsQuery(OWNER, NAME, 42);
    expect(q).toContain('reviewThreads');
    expect(q).toContain('isResolved');
    expect(q).toContain('isOutdated');
    expect(q).toContain('mergeCommit');
  });

  it('does NOT pre-filter with isResolved:false — surface, not filter (contract B)', () => {
    const q = buildReviewThreadsQuery(OWNER, NAME, 42);
    // The "surface, don't filter" ruling: no server-side resolution filter.
    expect(q).not.toMatch(/isResolved\s*:\s*false/);
    // requestArguments use parentheses, e.g. reviewThreads(first: 100) — there
    // must be no boolean argument predicate on isResolved.
    expect(q).not.toMatch(/reviewThreads\([^)]*isResolved/);
  });

  it('embeds owner/name as JSON-escaped strings and the numeric PR', () => {
    const q = buildReviewThreadsQuery(OWNER, NAME, 7);
    expect(q).toContain('owner: "mmnto-ai"');
    expect(q).toContain('name: "totem"');
    expect(q).toContain('pullRequest(number: 7)');
  });
});

describe('ReviewThreadSourceAdapter — query-spy through fetch', () => {
  it('passes a query that requests the resolution fields to gh', async () => {
    const exec = stubExec(okPayload({ threads: [{}] }));
    const adapter = new ReviewThreadSourceAdapter({ owner: OWNER, name: NAME, exec });
    await adapter.fetch(99);

    expect(exec.calls).toHaveLength(1);
    const args = exec.calls[0]!;
    expect(args[0]).toBe('api');
    expect(args[1]).toBe('graphql');
    const queryArg = args.find((a) => a.startsWith('query='));
    expect(queryArg).toBeDefined();
    expect(queryArg).toContain('isResolved');
    expect(queryArg).toContain('isOutdated');
    expect(queryArg).not.toMatch(/reviewThreads\([^)]*isResolved/);
  });
});

// ─── Mapping ─────────────────────────────────────────

describe('mapThreads', () => {
  it('surfaces per-thread isResolved/isOutdated flags (does not filter)', () => {
    const mapped = mapThreads(
      [
        {
          isResolved: true,
          isOutdated: false,
          path: 'a.ts',
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{ author: { login: 'jane' }, body: 'x' }],
          },
        },
        {
          isResolved: false,
          isOutdated: true,
          path: 'b.ts',
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{ author: { login: 'john' }, body: 'y' }],
          },
        },
      ],
      enrich,
    );
    // BOTH threads are present — nothing filtered out (surface, not filter).
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ path: 'a.ts', isResolved: true, isOutdated: false });
    expect(mapped[1]).toMatchObject({ path: 'b.ts', isResolved: false, isOutdated: true });
  });

  it('coerces a null author (deleted/ghost) to an empty login', () => {
    const mapped = mapThreads(
      [
        {
          isResolved: false,
          isOutdated: false,
          path: 'a.ts',
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [{ author: null, body: 'ghost note' }],
          },
        },
      ],
      enrich,
    );
    expect(mapped[0]!.comments[0]!.author).toBe('');
    expect(mapped[0]!.comments[0]!.body).toBe('ghost note');
  });

  it('slice β: stamps authorKind + de-chromed normalizedBody (bot stripped, human verbatim)', () => {
    const mapped = mapThreads(
      [
        {
          isResolved: false,
          isOutdated: false,
          path: 'a.ts',
          comments: {
            pageInfo: { hasNextPage: false },
            nodes: [
              {
                author: { login: 'coderabbitai[bot]' },
                body: '![high](https://x/high.svg)\nguard the divisor',
              },
              { author: { login: 'jane' }, body: 'the human rationale' },
            ],
          },
        },
      ],
      enrich,
    );
    const [bot, human] = mapped[0]!.comments;
    // Recognized review bot → authorKind 'bot' + chrome stripped from normalizedBody
    // (raw body retained for audit).
    expect(bot!.authorKind).toBe('bot');
    expect(bot!.body).toContain('![high]');
    expect(bot!.normalizedBody).toBe('guard the divisor');
    // Human → authorKind 'human' + normalizedBody verbatim.
    expect(human!.authorKind).toBe('human');
    expect(human!.normalizedBody).toBe('the human rationale');
  });
});

// ─── fetch() — payload → ReviewThreadContent + failure mapping ────────────────

describe('ReviewThreadSourceAdapter.fetch — success mapping', () => {
  it('maps a GraphQL payload to ReviewThreadContent with per-thread flags', async () => {
    const exec = stubExec(
      okPayload({
        mergeOid: MERGE_OID,
        threads: [
          {
            isResolved: false,
            isOutdated: false,
            path: 'x.ts',
            comments: [{ login: 'jane', body: 'eligible' }],
          },
          {
            isResolved: true,
            isOutdated: false,
            path: 'y.ts',
            comments: [{ login: 'john', body: 'resolved' }],
          },
        ],
      }),
    );
    const adapter = new ReviewThreadSourceAdapter({ owner: OWNER, name: NAME, exec });
    const result = await adapter.fetch(123);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.content.pr).toBe(123);
    expect(result.content.mergeCommitSha).toBe(MERGE_OID);
    expect(result.content.threads).toHaveLength(2);
    expect(result.content.threads[0]).toMatchObject({ isResolved: false, isOutdated: false });
    expect(result.content.threads[1]).toMatchObject({ isResolved: true, isOutdated: false });
  });

  it('lowercases the merge commit oid (provenance canonical form)', async () => {
    const exec = stubExec(okPayload({ mergeOid: 'A'.repeat(40), threads: [{}] }));
    const adapter = new ReviewThreadSourceAdapter({ owner: OWNER, name: NAME, exec });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.content.mergeCommitSha).toBe('a'.repeat(40));
  });
});

describe('ReviewThreadSourceAdapter.fetch — failure mapping (§6 discriminated)', () => {
  it('a thrown gh error (network/404/auth) maps to unreachable, never throws', async () => {
    // totem-context: this `new Error` SIMULATES an external `gh`/network throw the
    // adapter must catch — it is the third-party error under test, not a
    // Totem-originated one, so it deliberately carries no [Totem Error] prefix.
    const throwingExec: GhExec = () => {
      throw new Error('gh: HTTP 404: Not Found');
    };
    const adapter = new ReviewThreadSourceAdapter({ owner: OWNER, name: NAME, exec: throwingExec });
    const result = await adapter.fetch(404);
    expect(result.kind).toBe('unreachable');
    if (result.kind === 'unreachable') expect(result.detail).toContain('404');
  });

  it('invalid JSON maps to unparseable, never throws', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec('not json at all'),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unparseable');
  });

  it('a schema-mismatched payload maps to unparseable', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(JSON.stringify({ data: { repository: { pullRequest: { wrong: true } } } })),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unparseable');
  });

  it('a missing pullRequest maps to unreachable (PR not found)', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(JSON.stringify({ data: { repository: { pullRequest: null } } })),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unreachable');
    // PR-not-found detail names the PR, not the repository (CR + Greptile #2207).
    if (result.kind === 'unreachable') expect(result.detail).toContain('not found in');
  });

  it('a null repository (inaccessible / token scope) maps to unreachable with a repo-specific detail', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(JSON.stringify({ data: { repository: null } })),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unreachable');
    // Distinct from PR-not-found: the detail leads with the repository, not the PR
    // (CR + Greptile #2207 — don't send a token-scope failure chasing a missing PR).
    if (result.kind === 'unreachable') {
      expect(result.detail).toContain('repository');
      expect(result.detail).toContain('token scope');
    }
  });

  it('a null merge commit (unmerged / missing) maps to unparseable', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ mergeOid: null, threads: [{}] })),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unparseable');
    if (result.kind === 'unparseable') expect(result.detail).toContain('merge commit');
  });

  it('paginated review threads fail loud as unparseable (no silent shrink)', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ threads: [{}], threadsHasNext: true })),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unparseable');
    if (result.kind === 'unparseable') expect(result.detail).toContain('review threads');
  });

  it('paginated comments within a thread fail loud as unparseable', async () => {
    const adapter = new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(okPayload({ threads: [{ commentsHasNext: true }] })),
    });
    const result = await adapter.fetch(1);
    expect(result.kind).toBe('unparseable');
    if (result.kind === 'unparseable') expect(result.detail).toContain('comments');
  });
});

describe('ReviewThreadSourceAdapter.fetch — determinism', () => {
  it('identical payload → identical FetchResult', async () => {
    const payload = okPayload({
      threads: [
        { isResolved: false, comments: [{ login: 'jane', body: 'a' }] },
        { isResolved: true, comments: [{ login: 'john', body: 'b' }] },
      ],
    });
    const a = await new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(payload),
    }).fetch(5);
    const b = await new ReviewThreadSourceAdapter({
      owner: OWNER,
      name: NAME,
      exec: stubExec(payload),
    }).fetch(5);
    expect(a).toEqual(b);
  });
});
