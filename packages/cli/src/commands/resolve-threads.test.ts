import { describe, expect, it } from 'vitest';

import { type GhRunner, isBotReviewerLogin, isBotReviewerLoginExact } from '@mmnto/totem';

import {
  type BotIdentityPredicates,
  buildResolveThreadsPlan,
  classifyThread,
  deriveEvidence,
  isBotRootedThread,
  parseIdSelection,
  RESOLVE_THREAD_COMMENTS_QUERY,
  RESOLVE_THREAD_MUTATION,
  RESOLVE_THREADS_QUERY,
  resolveThreadsCommand,
  type ResolveThreadsRow,
  type ReviewThreadNode,
  toPrCommentRecords,
  toThreadRecords,
} from './resolve-threads.js';

// The SHIPPED identity definition (mmnto-ai/totem#2800), not a copy: the exact
// closed-list test on the GraphQL surface, the loose pattern on REST.
const identity: BotIdentityPredicates = {
  isBotLoginExact: isBotReviewerLoginExact,
  isBotLoginLoose: isBotReviewerLogin,
};

// ─── Fixture builders ────────────────────────────────────────────────────────

interface FakeComment {
  databaseId?: number | null;
  login: string | null;
  createdAt: string;
}

interface FakeThread {
  id: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  path?: string;
  comments: FakeComment[];
  /** Report a further comment page (followed by node id). */
  commentsHasNext?: boolean;
  /** The cursor for that page; null models a next page that cannot be followed. */
  commentsCursor?: string | null;
  /** The comments the node-id continuation answers with. */
  commentsNextPage?: FakeComment[];
}

interface FakePrComment {
  login: string | null;
  type?: string;
  createdAt?: string;
}

function commentNode(c: FakeComment): ReviewThreadNode['comments']['nodes'][number] {
  return {
    databaseId: c.databaseId === undefined ? 1 : c.databaseId,
    author: c.login === null ? null : { login: c.login },
    createdAt: c.createdAt,
  };
}

function threadNode(t: FakeThread): ReviewThreadNode {
  return {
    id: t.id,
    isResolved: t.isResolved ?? false,
    isOutdated: t.isOutdated ?? false,
    path: t.path ?? 'packages/cli/src/x.ts',
    comments: {
      pageInfo: {
        hasNextPage: t.commentsHasNext ?? false,
        endCursor: t.commentsCursor === undefined ? 'c0' : t.commentsCursor,
      },
      nodes: t.comments.map(commentNode),
    },
  };
}

interface RunnerSpec {
  threads: FakeThread[];
  prComments?: FakePrComment[];
  /** Report a further thread page. */
  threadsHasNext?: boolean;
  /** The cursor for that page; null models a next page that cannot be followed. */
  threadsCursor?: string | null;
  /** The threads the second page answers with (when `threadsCursor` is followable). */
  threadsSecondPage?: FakeThread[];
  /** Thread ids whose `resolveReviewThread` mutation fails. */
  mutationFailures?: string[];
  /** Make the whole threads read fail with this gh exit code. */
  threadsExitCode?: number;
  /** Answer the threads read with this raw body instead of a well-formed one. */
  threadsRawBody?: string;
  /** Make the PR-level comment read fail with this gh exit code. */
  prCommentsExitCode?: number;
}

interface Harness {
  runner: GhRunner;
  calls: string[][];
  /** Every `gh api graphql` document sent, in order. */
  queries: string[];
}

function makeRunner(spec: RunnerSpec): Harness {
  const calls: string[][] = [];
  const queries: string[] = [];
  const runner: GhRunner = (args: string[]) => {
    calls.push([...args]);

    if (args[0] === 'repo') return { stdout: 'mmnto-ai/totem\n', exitCode: 0 };

    if (args[0] === 'api' && args[1] === 'graphql') {
      const query = args.find((a) => a.startsWith('query='))?.slice('query='.length) ?? '';
      queries.push(query);

      if (query.includes('TotemResolveReviewThread')) {
        const threadId =
          args.find((a) => a.startsWith('threadId='))?.slice('threadId='.length) ?? '';
        if ((spec.mutationFailures ?? []).includes(threadId)) {
          return {
            stdout: JSON.stringify({ errors: [{ message: 'Resource not accessible' }] }),
            exitCode: 0,
          };
        }
        return {
          stdout: JSON.stringify({
            data: { resolveReviewThread: { thread: { id: threadId, isResolved: true } } },
          }),
          exitCode: 0,
        };
      }

      if (query.includes('TotemResolveThreadComments')) {
        const threadId =
          args.find((a) => a.startsWith('threadId='))?.slice('threadId='.length) ?? '';
        const thread = spec.threads.find((t) => t.id === threadId);
        return {
          stdout: JSON.stringify({
            data: {
              node: {
                comments: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: (thread?.commentsNextPage ?? []).map(commentNode),
                },
              },
            },
          }),
          exitCode: 0,
        };
      }

      // The thread read.
      if (spec.threadsExitCode !== undefined && spec.threadsExitCode !== 0) {
        return { stdout: 'gh: API rate limit exceeded', exitCode: spec.threadsExitCode };
      }
      if (spec.threadsRawBody !== undefined) {
        return { stdout: spec.threadsRawBody, exitCode: 0 };
      }
      const after = args.find((a) => a.startsWith('threadsAfter='));
      const first = after === undefined;
      const nodes = first ? spec.threads : (spec.threadsSecondPage ?? []);
      return {
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: {
                    hasNextPage: first ? (spec.threadsHasNext ?? false) : false,
                    endCursor: first
                      ? spec.threadsCursor === undefined
                        ? 't0'
                        : spec.threadsCursor
                      : null,
                  },
                  nodes: nodes.map(threadNode),
                },
              },
            },
          },
        }),
        exitCode: 0,
      };
    }

    // The REST issue-comment read.
    if (spec.prCommentsExitCode !== undefined && spec.prCommentsExitCode !== 0) {
      return { stdout: 'gh: Not Found', exitCode: spec.prCommentsExitCode };
    }
    return {
      stdout: JSON.stringify(
        (spec.prComments ?? []).map((c, i) => ({
          id: 100 + i,
          user: c.login === null ? null : { login: c.login, type: c.type ?? 'User' },
          created_at: c.createdAt,
        })),
      ),
      exitCode: 0,
    };
  };
  return { runner, calls, queries };
}

interface RunResult {
  exitCode: 0 | 1 | 2;
  rows: ResolveThreadsRow[];
  stdout: string;
  stderr: string;
  calls: string[][];
  queries: string[];
}

async function run(
  spec: RunnerSpec,
  opts: { apply?: boolean; ids?: string; json?: boolean; pr?: string } = {},
): Promise<RunResult> {
  const harness = makeRunner(spec);
  let stdout = '';
  let stderr = '';
  const result = await resolveThreadsCommand(opts.pr ?? '2839', {
    ...(opts.apply === undefined ? {} : { apply: opts.apply }),
    ...(opts.ids === undefined ? {} : { ids: opts.ids }),
    ...(opts.json === undefined ? {} : { json: opts.json }),
    runner: harness.runner,
    out: (t) => {
      stdout += t;
    },
    err: (t) => {
      stderr += t;
    },
  });
  return { ...result, stdout, stderr, calls: harness.calls, queries: harness.queries };
}

/** Every mutation call the run made. */
function mutationCalls(calls: string[][]): string[][] {
  return calls.filter((c) => c.some((a) => a.includes('TotemResolveReviewThread')));
}

const BOT_ROOT = { login: 'coderabbitai', createdAt: '2026-09-08T03:32:00Z' };

// ─── Real capture (disclosed) ────────────────────────────────────────────────
//
// Captured read-only from mmnto-ai/totem#2839 on 2026-09-08T04:19:20Z with
// `gh api graphql` (review threads) and `gh api repos/mmnto-ai/totem/issues/2839/comments`
// (PR-level comments). Three bot-rooted threads, none with an in-thread reply;
// two human PR-level comments, one BEFORE every thread root (the round-trigger
// comment) and one AFTER (the round disposition). Trimmed to the fields the
// verb reads; ids, logins and instants are verbatim.
const CAPTURE_2839: RunnerSpec = {
  threads: [
    {
      id: 'PRRT_kwDORatBZ86gFX3q',
      path: 'scripts/sync-labels.ps1',
      comments: [
        { databaseId: 3954062164, login: 'greptile-apps', createdAt: '2026-09-08T03:30:29Z' },
      ],
    },
    {
      id: 'PRRT_kwDORatBZ86gFX3s',
      path: 'packages/cli/src/commands/sync-labels-forms.test.ts',
      comments: [
        { databaseId: 3954062167, login: 'greptile-apps', createdAt: '2026-09-08T03:30:29Z' },
      ],
    },
    {
      id: 'PRRT_kwDORatBZ86gFYvi',
      path: 'scripts/sync-labels.ps1',
      comments: [
        { databaseId: 3954067481, login: 'coderabbitai', createdAt: '2026-09-08T03:32:00Z' },
      ],
    },
  ],
  prComments: [
    { login: 'satur8d', createdAt: '2026-09-08T03:24:01Z' },
    { login: 'coderabbitai[bot]', type: 'Bot', createdAt: '2026-09-08T03:24:15Z' },
    { login: 'greptile-apps[bot]', type: 'Bot', createdAt: '2026-09-08T03:30:23Z' },
    { login: 'satur8d', createdAt: '2026-09-08T03:42:27Z' },
    { login: 'greptile-apps[bot]', type: 'Bot', createdAt: '2026-09-08T03:42:53Z' },
  ],
};

// ─── Pure classification ─────────────────────────────────────────────────────

describe('resolve-threads classification', () => {
  it('correctlyClassifiesVaryingThreadStatus', () => {
    const records = toThreadRecords(
      [
        threadNode({
          id: 'T-human-reply',
          comments: [BOT_ROOT, { login: 'satur8d', createdAt: '2026-09-08T04:00:00Z' }],
        }),
        threadNode({
          id: 'T-bot-replies-only',
          comments: [BOT_ROOT, { login: 'coderabbitai', createdAt: '2026-09-08T04:00:00Z' }],
        }),
        threadNode({ id: 'T-no-reply', comments: [BOT_ROOT] }),
        threadNode({
          id: 'T-human-rooted',
          comments: [{ login: 'satur8d', createdAt: '2026-09-08T03:00:00Z' }],
        }),
        threadNode({ id: 'T-resolved', isResolved: true, comments: [BOT_ROOT] }),
        threadNode({ id: 'T-outdated', isOutdated: true, comments: [BOT_ROOT] }),
      ],
      identity,
    );

    const byId = new Map(records.map((r) => [r.id, r]));
    const verdicts = records.map((r) => ({
      id: r.id,
      candidate: isBotRootedThread(r, identity),
      verdict: classifyThread(r, deriveEvidence(r, []), true),
    }));

    expect(byId.get('T-human-reply')?.humanReplyCount).toBe(1);
    expect(byId.get('T-bot-replies-only')?.humanReplyCount).toBe(0);
    expect(verdicts).toEqual([
      { id: 'T-human-reply', candidate: true, verdict: 'resolve' },
      { id: 'T-bot-replies-only', candidate: true, verdict: 'skip:no-evidence' },
      { id: 'T-no-reply', candidate: true, verdict: 'skip:no-evidence' },
      { id: 'T-human-rooted', candidate: false, verdict: 'skip:no-evidence' },
      { id: 'T-resolved', candidate: true, verdict: 'skip:already-resolved' },
      { id: 'T-outdated', candidate: true, verdict: 'skip:outdated' },
    ]);
  });

  it('treats a deleted account (null author) as non-bot on both surfaces', () => {
    const [botRootWithGhostReply, ghostRooted] = toThreadRecords(
      [
        threadNode({
          id: 'T-ghost-reply',
          comments: [BOT_ROOT, { login: null, createdAt: '2026-09-08T04:00:00Z' }],
        }),
        threadNode({ id: 'T-ghost-root', comments: [{ login: null, createdAt: '2026-09-08Z' }] }),
      ],
      identity,
    );

    // A ghost reply is a HUMAN reply (never a bot identity) — evidence.
    expect(botRootWithGhostReply?.humanReplyCount).toBe(1);
    expect(deriveEvidence(botRootWithGhostReply!, [])).toBe('in-thread-reply');
    // A ghost ROOT is not a bot root, so the thread is not a candidate at all.
    expect(isBotRootedThread(ghostRooted!, identity)).toBe(false);
    // And a ghost PR-level comment is non-bot too.
    expect(toPrCommentRecords([{ id: 1, user: null, created_at: 'x' }], identity)[0]?.isBot).toBe(
      false,
    );
  });

  it('reads the REST surface with the loose pattern and the [bot]/type test', () => {
    const records = toPrCommentRecords(
      [
        { id: 1, user: { login: 'satur8d', type: 'User' }, created_at: 'a' },
        { id: 2, user: { login: 'coderabbitai[bot]', type: 'Bot' }, created_at: 'b' },
        // A GitHub App that is NOT a review bot is still not the human disposition.
        { id: 3, user: { login: 'github-actions[bot]', type: 'Bot' }, created_at: 'c' },
        // A human account whose name merely contains a bot's name stays human.
        { id: 4, user: { login: 'alice-greptile', type: 'User' }, created_at: 'd' },
      ],
      identity,
    );
    expect(records.map((r) => r.isBot)).toEqual([false, true, true, false]);
  });

  it('parses --ids and refuses a malformed entry', () => {
    expect(parseIdSelection(undefined)).toEqual({ ok: true, ids: null });
    expect(parseIdSelection('  ')).toEqual({ ok: true, ids: null });
    expect(parseIdSelection('12, #34')).toEqual({ ok: true, ids: [12, 34] });
    expect(parseIdSelection('12,not-an-id')).toEqual({ ok: false, invalid: ['not-an-id'] });
  });

  it('emits exactly one plan row per bot-rooted thread and none for a human-rooted one', () => {
    const records = toThreadRecords(
      [
        threadNode({ id: 'T-bot', comments: [BOT_ROOT] }),
        threadNode({
          id: 'T-human',
          comments: [{ login: 'satur8d', createdAt: '2026-09-08T03:00:00Z' }],
        }),
      ],
      identity,
    );
    const plan = buildResolveThreadsPlan(records, [], identity, null);
    expect(plan.rows.map((r) => r.threadId)).toEqual(['T-bot']);
  });
});

// ─── The evidence rule (R2), including the GCA case ──────────────────────────

describe('resolve-threads evidence rule (R2)', () => {
  it('resolves a GCA thread with no in-thread reply when a human PR comment lands AFTER the root', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-gca',
          comments: [
            { databaseId: 555, login: 'gemini-code-assist', createdAt: '2026-09-08T03:30:00Z' },
          ],
        },
      ],
      prComments: [{ login: 'satur8d', createdAt: '2026-09-08T03:42:00Z' }],
    });
    expect(result.rows.map((r) => [r.verdict, r.evidence])).toEqual([
      ['resolve', 'pr-level-disposition'],
    ]);
    expect(result.exitCode).toBe(0);
  });

  it('does NOT resolve the same thread when the human PR comment predates the root', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-gca',
          comments: [
            { databaseId: 555, login: 'gemini-code-assist', createdAt: '2026-09-08T03:30:00Z' },
          ],
        },
      ],
      prComments: [{ login: 'satur8d', createdAt: '2026-09-08T03:24:00Z' }],
    });
    expect(result.rows.map((r) => [r.verdict, r.evidence])).toEqual([['skip:no-evidence', 'none']]);
    expect(result.stdout).toContain('give it evidence');
  });

  it('does not accept a BOT PR-level comment as the disposition', async () => {
    const result = await run({
      threads: [{ id: 'T', comments: [{ databaseId: 1, ...BOT_ROOT }] }],
      prComments: [
        { login: 'coderabbitai[bot]', type: 'Bot', createdAt: '2026-09-08T04:00:00Z' },
        { login: 'github-actions[bot]', type: 'Bot', createdAt: '2026-09-08T04:01:00Z' },
      ],
    });
    expect(result.rows[0]?.verdict).toBe('skip:no-evidence');
  });

  it('never resolves an evidence-free thread even under --apply, and exits 2', async () => {
    const result = await run(
      {
        threads: [{ id: 'T-none', comments: [{ databaseId: 1, ...BOT_ROOT }] }],
      },
      { apply: true },
    );
    expect(result.rows[0]?.verdict).toBe('skip:no-evidence');
    expect(mutationCalls(result.calls)).toHaveLength(0);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('no disposition evidence');
  });

  it('applies the evidenced rows and STILL exits 2 when a selected row had no evidence', async () => {
    const result = await run(
      {
        threads: [
          {
            id: 'T-ok',
            comments: [
              { databaseId: 1, ...BOT_ROOT },
              { databaseId: 2, login: 'satur8d', createdAt: '2026-09-08T04:00:00Z' },
            ],
          },
          { id: 'T-none', comments: [{ databaseId: 3, ...BOT_ROOT }] },
        ],
      },
      { apply: true },
    );
    expect(mutationCalls(result.calls)).toHaveLength(1);
    expect(result.rows.find((r) => r.threadId === 'T-ok')?.applied).toBe(true);
    expect(result.rows.find((r) => r.threadId === 'T-none')?.applied).toBeNull();
    expect(result.exitCode).toBe(2);
  });
});

// ─── Mutation discipline ─────────────────────────────────────────────────────

describe('resolve-threads mutation discipline', () => {
  const evidenced: RunnerSpec = {
    threads: [
      {
        id: 'T-a',
        comments: [
          { databaseId: 11, ...BOT_ROOT },
          { databaseId: 12, login: 'satur8d', createdAt: '2026-09-08T04:00:00Z' },
        ],
      },
      {
        id: 'T-b',
        comments: [{ databaseId: 21, login: 'greptile-apps', createdAt: '2026-09-08T03:30:00Z' }],
      },
      { id: 'T-resolved', isResolved: true, comments: [{ databaseId: 31, ...BOT_ROOT }] },
      { id: 'T-outdated', isOutdated: true, comments: [{ databaseId: 41, ...BOT_ROOT }] },
    ],
    prComments: [{ login: 'satur8d', createdAt: '2026-09-08T04:05:00Z' }],
  };

  it('dry-run (the default) performs zero mutations', async () => {
    const result = await run(evidenced);
    expect(mutationCalls(result.calls)).toHaveLength(0);
    expect(result.rows.every((r) => r.applied === null)).toBe(true);
    expect(result.stdout).toContain('dry-run');
    expect(result.exitCode).toBe(0);
  });

  it('--apply issues exactly one resolveReviewThread per resolve row and none for a skip row', async () => {
    const result = await run(evidenced, { apply: true });
    const mutations = mutationCalls(result.calls);
    expect(mutations).toHaveLength(2);
    const ids = mutations.map((c) =>
      c.find((a) => a.startsWith('threadId='))?.slice('threadId='.length),
    );
    expect(ids.sort()).toEqual(['T-a', 'T-b']);
    // The resolved and outdated threads are reported and never mutated.
    expect(result.rows.find((r) => r.threadId === 'T-resolved')?.verdict).toBe(
      'skip:already-resolved',
    );
    expect(result.rows.find((r) => r.threadId === 'T-outdated')?.verdict).toBe('skip:outdated');
    expect(result.exitCode).toBe(0);
  });

  it('sends the resolveReviewThread mutation and nothing else that could write', async () => {
    const result = await run(evidenced, { apply: true });
    // Not one call posts a comment, an inline reply, or a review.
    const flat = result.calls.map((c) => c.join(' '));
    for (const call of flat) {
      expect(call).not.toMatch(/\bpr comment\b/);
      expect(call).not.toMatch(/\/replies\b/);
      expect(call).not.toMatch(/\/reviews\b/);
      expect(call).not.toMatch(/\bissue comment\b/);
      expect(call).not.toMatch(/--method\s+(POST|PATCH|PUT|DELETE)/);
    }
    // Every GraphQL document sent is one of the three this module declares.
    for (const q of result.queries) {
      expect([
        RESOLVE_THREADS_QUERY,
        RESOLVE_THREAD_COMMENTS_QUERY,
        RESOLVE_THREAD_MUTATION,
      ]).toContain(q);
    }
    expect(result.queries.filter((q) => q === RESOLVE_THREAD_MUTATION)).toHaveLength(2);
  });

  it('continues past a failed mutation and exits 2 naming the count', async () => {
    const result = await run({ ...evidenced, mutationFailures: ['T-a'] }, { apply: true });
    expect(mutationCalls(result.calls)).toHaveLength(2);
    expect(result.rows.find((r) => r.threadId === 'T-a')?.applied).toBe(false);
    expect(result.rows.find((r) => r.threadId === 'T-b')?.applied).toBe(true);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('1 thread(s) failed to resolve');
  });
});

// ─── Selection (R4) ──────────────────────────────────────────────────────────

describe('resolve-threads selection (R4)', () => {
  const spec: RunnerSpec = {
    threads: [
      { id: 'T-a', comments: [{ databaseId: 11, ...BOT_ROOT }] },
      { id: 'T-b', comments: [{ databaseId: 21, ...BOT_ROOT }] },
    ],
    prComments: [{ login: 'satur8d', createdAt: '2026-09-08T04:05:00Z' }],
  };

  it('resolves every evidenced bot thread when no --ids is given', async () => {
    const result = await run(spec, { apply: true });
    expect(mutationCalls(result.calls)).toHaveLength(2);
  });

  it('--ids narrows the batch and the unselected row says so', async () => {
    const result = await run(spec, { apply: true, ids: '11' });
    expect(mutationCalls(result.calls)).toHaveLength(1);
    expect(result.rows.find((r) => r.threadId === 'T-b')?.verdict).toBe('skip:not-selected');
    expect(result.exitCode).toBe(0);
  });

  it('an unmatched id aborts before ANY mutation, exit 2', async () => {
    const result = await run(spec, { apply: true, ids: '11,999999' });
    expect(mutationCalls(result.calls)).toHaveLength(0);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('999999');
    expect(result.stderr).toContain('nothing was resolved');
  });

  it('a malformed id aborts before any read of the plan, exit 2', async () => {
    const result = await run(spec, { apply: true, ids: 'oops' });
    expect(mutationCalls(result.calls)).toHaveLength(0);
    expect(result.exitCode).toBe(2);
  });

  it('prints the REST root comment id beside every row', async () => {
    const result = await run(spec);
    expect(result.stdout).toContain('id=11');
    expect(result.stdout).toContain('id=21');
  });
});

// ─── Reads that did not complete ─────────────────────────────────────────────

describe('resolve-threads read failures', () => {
  it('fails hard when a next page of threads cannot be followed — never a partial plan', async () => {
    const result = await run({
      threads: [{ id: 'T-a', comments: [{ databaseId: 11, ...BOT_ROOT }] }],
      threadsHasNext: true,
      threadsCursor: null,
    });
    expect(result.exitCode).toBe(1);
    expect(result.rows).toHaveLength(0);
    expect(result.stderr).toContain('review threads NOT read');
    expect(mutationCalls(result.calls)).toHaveLength(0);
  });

  it('follows a thread page that CAN be followed', async () => {
    const result = await run({
      threads: [{ id: 'T-a', comments: [{ databaseId: 11, ...BOT_ROOT }] }],
      threadsHasNext: true,
      threadsCursor: 't1',
      threadsSecondPage: [{ id: 'T-b', comments: [{ databaseId: 21, ...BOT_ROOT }] }],
      prComments: [{ login: 'satur8d', createdAt: '2026-09-08T04:05:00Z' }],
    });
    expect(result.rows.map((r) => r.threadId)).toEqual(['T-a', 'T-b']);
    expect(result.exitCode).toBe(0);
  });

  it('follows a thread comment page by node id, and the extra page can carry the evidence', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-a',
          comments: [{ databaseId: 11, ...BOT_ROOT }],
          commentsHasNext: true,
          commentsCursor: 'c1',
          commentsNextPage: [
            { databaseId: 12, login: 'satur8d', createdAt: '2026-09-08T04:00:00Z' },
          ],
        },
      ],
    });
    expect(result.rows[0]?.evidence).toBe('in-thread-reply');
    expect(result.queries.some((q) => q === RESOLVE_THREAD_COMMENTS_QUERY)).toBe(true);
  });

  it('fails hard when a thread comment page cannot be followed', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-a',
          comments: [{ databaseId: 11, ...BOT_ROOT }],
          commentsHasNext: true,
          commentsCursor: null,
        },
      ],
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no cursor to follow');
  });

  it('rejectsMalformattedGraphQLThreads', async () => {
    const result = await run({
      threads: [],
      threadsRawBody: JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                // `author` must be an object-or-null; a bare string is malformed.
                nodes: [
                  {
                    id: 'T',
                    isResolved: false,
                    isOutdated: false,
                    path: 'a.ts',
                    comments: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [{ databaseId: 1, author: 'coderabbitai', createdAt: 'x' }],
                    },
                  },
                ],
              },
            },
          },
        },
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('did not match the expected shape');
    expect(mutationCalls(result.calls)).toHaveLength(0);
  });

  it('fails hard when gh does not answer the thread read', async () => {
    const result = await run({ threads: [], threadsExitCode: 1 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('gh exited 1');
  });

  it('fails hard when the PR-level comment read fails — evidence cannot be derived', async () => {
    const result = await run({
      threads: [{ id: 'T-a', comments: [{ databaseId: 11, ...BOT_ROOT }] }],
      prCommentsExitCode: 1,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('evidence cannot be derived');
    expect(mutationCalls(result.calls)).toHaveLength(0);
  });

  it('fails hard when the PR is not found', async () => {
    const result = await run({
      threads: [],
      threadsRawBody: JSON.stringify({ data: { repository: { pullRequest: null } } }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('PR #2839 not found');
  });

  it('fails hard when the repository is inaccessible', async () => {
    const result = await run({
      threads: [],
      threadsRawBody: JSON.stringify({ data: { repository: null } }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found or inaccessible');
  });

  it('fails hard and names the cure when gh cannot resolve the repository', async () => {
    let stdout = '';
    let stderr = '';
    const calls: string[][] = [];
    const result = await resolveThreadsCommand('2839', {
      runner: (args: string[]) => {
        calls.push([...args]);
        return { stdout: 'gh: not authenticated', exitCode: 4 };
      },
      out: (t) => {
        stdout += t;
      },
      err: (t) => {
        stderr += t;
      },
    });
    expect(result.exitCode).toBe(1);
    expect(stderr).toContain('gh auth status');
    expect(stdout).toBe('');
    // It gave up on the FIRST call — no read, no mutation.
    expect(calls).toHaveLength(1);
  });

  it('reports nothing to resolve when the PR has no bot-rooted thread', async () => {
    const result = await run({
      threads: [
        { id: 'T-human', comments: [{ databaseId: 11, login: 'satur8d', createdAt: 'x' }] },
      ],
    });
    expect(result.stdout).toContain('nothing to resolve');
    expect(result.exitCode).toBe(0);
  });
});

// ─── Output surfaces ─────────────────────────────────────────────────────────

describe('resolve-threads output', () => {
  it('--json carries the same rows and nothing else on stdout', async () => {
    const result = await run(CAPTURE_2839, { json: true });
    const doc = JSON.parse(result.stdout) as {
      repo: string;
      pr: number;
      apply: boolean;
      rows: ResolveThreadsRow[];
      summary: Record<string, number>;
    };
    expect(doc.repo).toBe('mmnto-ai/totem');
    expect(doc.pr).toBe(2839);
    expect(doc.apply).toBe(false);
    expect(doc.rows).toEqual(result.rows);
    expect(doc.summary['resolve']).toBe(3);
  });

  it('the mmnto-ai/totem#2839 capture: three bot threads, all carried by the later human disposition', async () => {
    const result = await run(CAPTURE_2839);
    expect(result.rows.map((r) => [r.rootCommentId, r.verdict, r.evidence])).toEqual([
      [3954062164, 'resolve', 'pr-level-disposition'],
      [3954062167, 'resolve', 'pr-level-disposition'],
      [3954067481, 'resolve', 'pr-level-disposition'],
    ]);
    expect(result.exitCode).toBe(0);
    expect(mutationCalls(result.calls)).toHaveLength(0);
  });

  it('refuses a non-numeric PR argument before any gh call', async () => {
    const result = await run(CAPTURE_2839, { pr: 'main' });
    expect(result.exitCode).toBe(1);
    expect(result.calls).toHaveLength(0);
  });
});
