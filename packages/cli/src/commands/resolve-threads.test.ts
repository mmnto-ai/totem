import { describe, expect, it } from 'vitest';

import {
  BOT_REVIEWER_IDENTITIES,
  type GhRunner,
  isBotReviewerLogin,
  isBotReviewerLoginExact,
} from '@mmnto/totem';

import {
  type BotIdentityPredicates,
  buildResolveThreadsPlan,
  classifyThread,
  confirmResolved,
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

/**
 * The review-bot logins a fixture models as `__typename: "Bot"` by default,
 * DERIVED from core's `BOT_REVIEWER_IDENTITIES` (both spellings, with and
 * without the `[bot]` suffix) rather than hand-listed — a hand-listed copy
 * drifts the moment core gains or renames an identity, and it already had:
 * the first version omitted `github-code-quality` while carrying an entry that
 * is not a review bot at all.
 *
 * OBSERVED vs DECLARED, kept honest: only `greptile-apps` and `coderabbitai`
 * were read from the real API (mmnto-ai/totem#2839, 2026-09-08T06:03:03Z, both
 * answering `__typename: "Bot"` with no `[bot]` suffix on the login). The other
 * identities are taken from core's declaration, not from an observation made
 * here. A fixture may override `typename` explicitly; this only keeps the
 * DEFAULT honest so a test cannot accidentally model a review bot as a User.
 */
const CORE_BOT_LOGINS = BOT_REVIEWER_IDENTITIES.flatMap((id) => [...id.exactLogins]);

/**
 * A GitHub App that is NOT one of core's review bots — the whole point of the
 * three-arm bot test (fold F2): core's list is closed, but any App can reply in
 * a thread, and an App's comment is not a human answer. Deliberately a SEPARATE
 * constant from {@link CORE_BOT_LOGINS} so the two ideas cannot be conflated.
 */
const APP_NOT_A_REVIEW_BOT = 'github-actions';

interface FakeComment {
  databaseId?: number | null;
  login: string | null;
  /** GraphQL `author.__typename`. Defaults to the honest value for the login. */
  typename?: string;
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

function defaultTypename(login: string): string {
  const lower = login.toLowerCase();
  const isCoreReviewBot = CORE_BOT_LOGINS.includes(lower);
  const isOtherApp = lower === APP_NOT_A_REVIEW_BOT || /\[bot\]$/i.test(login);
  return isCoreReviewBot || isOtherApp ? 'Bot' : 'User';
}

function commentNode(c: FakeComment): ReviewThreadNode['comments']['nodes'][number] {
  return {
    databaseId: c.databaseId === undefined ? 1 : c.databaseId,
    author:
      c.login === null
        ? null
        : { __typename: c.typename ?? defaultTypename(c.login), login: c.login },
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
  /** Thread ids whose `resolveReviewThread` mutation fails (a GraphQL errors body). */
  mutationFailures?: string[];
  /** Thread id → a raw mutation body to answer with (a clean gh exit, an unusable answer). */
  mutationRawBody?: Record<string, string>;
  /** Make the whole threads read fail with this gh exit code. */
  threadsExitCode?: number;
  /** Answer the threads read with this raw body instead of a well-formed one. */
  threadsRawBody?: string;
  /** Make the PR-level comment read fail with this gh exit code. */
  prCommentsExitCode?: number;
  /** Make the `gh --version` probe fail with this exit code (gh absent / broken). */
  ghVersionExitCode?: number;
  /** Every thread page reports a followable next page (the MAX_PAGES exhaustion path). */
  threadsAlwaysHasNext?: boolean;
  /** Every comment continuation reports a followable next page (the per-thread exhaustion path). */
  commentsAlwaysHasNext?: boolean;
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

    // The gh precondition probe: a non-zero answer models gh absent or broken.
    if (args[0] === '--version') {
      return spec.ghVersionExitCode !== undefined && spec.ghVersionExitCode !== 0
        ? { stdout: 'spawn gh ENOENT', exitCode: spec.ghVersionExitCode }
        : { stdout: 'gh version 2.99.0 (2026-09-01)\n', exitCode: 0 };
    }

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
        const raw = spec.mutationRawBody?.[threadId];
        if (raw !== undefined) return { stdout: raw, exitCode: 0 };
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
                  pageInfo:
                    spec.commentsAlwaysHasNext === true
                      ? { hasNextPage: true, endCursor: 'c-more' }
                      : { hasNextPage: false, endCursor: null },
                  nodes: (thread?.commentsNextPage ?? []).map(commentNode),
                },
              },
            },
          }),
          exitCode: 0,
        };
      }

      // The thread read. A non-zero exit carries the raw body when one is given
      // (gh prints the GraphQL body on stdout AND exits 1 for a NOT_FOUND —
      // observed 2026-09-08), else a canned failure string.
      if (spec.threadsExitCode !== undefined && spec.threadsExitCode !== 0) {
        return {
          stdout: spec.threadsRawBody ?? 'gh: API rate limit exceeded',
          exitCode: spec.threadsExitCode,
        };
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
                  pageInfo:
                    spec.threadsAlwaysHasNext === true
                      ? { hasNextPage: true, endCursor: `t-${calls.length}` }
                      : {
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

// ─── The exec ALLOWLIST ──────────────────────────────────────────────────────
//
// An ALLOWLIST, deliberately, not a denylist: "no `pr comment`, no `/replies`,
// no `/reviews`" only refuses the write shapes someone thought to enumerate, and
// a write nobody listed (`gh pr review --approve`, `gh api -X POST …`,
// `gh api --method PUT …`, an `addComment` GraphQL mutation) sails through. So
// every argv the seam records must match exactly ONE of the six shapes this
// verb is allowed to send; anything else THROWS, including a mutation under
// dry-run. `rejects a write argv` below is the mutant check that this predicate
// actually refuses writes.

/** The six exec shapes the verb may send (the `--version` probe joined in the PR's review round). */
type ExecShape =
  | 'gh-version'
  | 'repo-view'
  | 'threads-read'
  | 'comments-read'
  | 'mutation'
  | 'issue-comments';

const ISSUE_COMMENTS_PATH = /^repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/issues\/\d+\/comments$/;

/** Variables each declared document is allowed to carry. */
const ALLOWED_VARIABLES: Record<
  Exclude<ExecShape, 'gh-version' | 'repo-view' | 'issue-comments'>,
  string[]
> = {
  'threads-read': ['owner', 'name', 'number', 'threadsAfter'],
  'comments-read': ['threadId', 'commentsAfter'],
  mutation: ['threadId'],
};

function classifyExecShape(args: readonly string[]): ExecShape {
  const reject = (why: string): never => {
    throw new Error(`argv is not a declared exec shape (${why}): ${JSON.stringify(args)}`);
  };

  // The precondition probe: exactly `gh --version`, nothing riding on it.
  if (args[0] === '--version') {
    if (args.length !== 1) return reject('the version probe takes no other argument');
    return 'gh-version';
  }

  if (args[0] === 'repo') {
    if (args.join(' ') !== 'repo view --json nameWithOwner --jq .nameWithOwner') {
      return reject('unexpected `gh repo` argv');
    }
    return 'repo-view';
  }

  if (args[0] !== 'api')
    return reject('only `gh --version`, `gh repo view` and `gh api` are declared');

  if (args[1] === 'graphql') {
    if (args[2] !== '-f' || args[3]?.startsWith('query=') !== true) {
      return reject('a graphql call must pass the document as `-f query=…`');
    }
    const document = args[3].slice('query='.length);
    const shape: ExecShape | null =
      document === RESOLVE_THREADS_QUERY
        ? 'threads-read'
        : document === RESOLVE_THREAD_COMMENTS_QUERY
          ? 'comments-read'
          : document === RESOLVE_THREAD_MUTATION
            ? 'mutation'
            : null;
    if (shape === null) return reject('the document is not one of the three declared constants');
    const allowed = ALLOWED_VARIABLES[shape as keyof typeof ALLOWED_VARIABLES];
    for (let i = 4; i < args.length; i += 2) {
      const flag = args[i];
      const pair = args[i + 1];
      if (flag !== '-f' && flag !== '-F') return reject(`unexpected flag ${String(flag)}`);
      const key = pair?.split('=')[0] ?? '';
      if (!allowed.includes(key)) return reject(`unexpected variable ${key}`);
    }
    return shape;
  }

  // A REST call: exactly the paginated issue-comment READ, nothing else. Any
  // method flag at all is a write attempt and is refused by falling through.
  if (args.length !== 3 || !ISSUE_COMMENTS_PATH.test(args[1] ?? '') || args[2] !== '--paginate') {
    return reject('the only declared REST call is the paginated issue-comment read');
  }
  return 'issue-comments';
}

/**
 * Assert every recorded argv is a declared shape, and that a mutation appears
 * only when `--apply` was passed. Throws on the first offender.
 */
function assertOnlyDeclaredExecShapes(
  calls: readonly (readonly string[])[],
  opts: { apply: boolean },
): ExecShape[] {
  return calls.map((args) => {
    const shape = classifyExecShape(args);
    if (shape === 'mutation' && !opts.apply) {
      throw new Error(`a mutation was sent without --apply: ${JSON.stringify(args)}`);
    }
    return shape;
  });
}

const BOT_ROOT = { login: 'coderabbitai', createdAt: '2026-09-08T03:32:00Z' };

// ─── Real capture (disclosed) ────────────────────────────────────────────────
//
// Captured READ-ONLY from mmnto-ai/totem#2839: the review threads at
// 2026-09-08T06:03:03Z (`gh api graphql`, the same selection set
// RESOLVE_THREADS_QUERY sends, `author { __typename login }` included) and the
// PR-level comments at 2026-09-08T06:03:12Z
// (`gh api repos/mmnto-ai/totem/issues/2839/comments --paginate`). Both clock
// reads are from the same shell as the capture.
//
// COMPLETE, not trimmed by row: all three review threads and ALL SEVEN PR-level
// comments the PR carried at that instant are here, including the four bot ones
// that change no verdict — a fixture that quietly dropped the inert rows would
// stop being a witness to what the verb actually reads. Only the FIELDS are
// reduced (to the ones the verb reads: ids, logins, __typename/type, instants,
// paths); every value is verbatim.
//
// What it witnesses: three bot-rooted threads (two greptile, one coderabbit),
// none with an in-thread reply; a human comment at 03:24:01Z BEFORE every
// thread root (the round-trigger comment — not evidence for any of them) and a
// human comment at 03:42:27Z AFTER all three (the round disposition). Note the
// GraphQL logins carry no `[bot]` suffix while `__typename` is `Bot` — the trap
// the three-arm bot test exists for.
const CAPTURE_2839: RunnerSpec = {
  threads: [
    {
      id: 'PRRT_kwDORatBZ86gFX3q',
      path: 'scripts/sync-labels.ps1',
      comments: [
        {
          databaseId: 3954062164,
          login: 'greptile-apps',
          typename: 'Bot',
          createdAt: '2026-09-08T03:30:29Z',
        },
      ],
    },
    {
      id: 'PRRT_kwDORatBZ86gFX3s',
      path: 'packages/cli/src/commands/sync-labels-forms.test.ts',
      comments: [
        {
          databaseId: 3954062167,
          login: 'greptile-apps',
          typename: 'Bot',
          createdAt: '2026-09-08T03:30:29Z',
        },
      ],
    },
    {
      id: 'PRRT_kwDORatBZ86gFYvi',
      path: 'scripts/sync-labels.ps1',
      comments: [
        {
          databaseId: 3954067481,
          login: 'coderabbitai',
          typename: 'Bot',
          createdAt: '2026-09-08T03:32:00Z',
        },
      ],
    },
  ],
  prComments: [
    { login: 'satur8d', createdAt: '2026-09-08T03:24:01Z' },
    { login: 'coderabbitai[bot]', type: 'Bot', createdAt: '2026-09-08T03:24:15Z' },
    { login: 'greptile-apps[bot]', type: 'Bot', createdAt: '2026-09-08T03:30:23Z' },
    { login: 'coderabbitai[bot]', type: 'Bot', createdAt: '2026-09-08T03:31:57Z' },
    { login: 'satur8d', createdAt: '2026-09-08T03:42:27Z' },
    { login: 'coderabbitai[bot]', type: 'Bot', createdAt: '2026-09-08T03:42:48Z' },
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
        // NARROW claim: `alice-greptile` stays human because core's greptile
        // pattern REQUIRES the `[bot]` suffix. That is true of the greptile and
        // ghcq arms only — it is NOT a general property of the loose pattern
        // (see the disclosed limit below).
        { id: 4, user: { login: 'alice-greptile', type: 'User' }, created_at: 'd' },
      ],
      identity,
    );
    expect(records.map((r) => r.isBot)).toEqual([false, true, true, false]);
  });

  it('DISCLOSED LIMIT: a human whose login contains `coderabbit` reads as a bot on REST', async () => {
    // core's coderabbit arm is a bare substring (`/coderabbit/i`, no `[bot]`
    // requirement), so a real human account named `coderabbit-fan` is classified
    // as a bot on the REST surface and its PR-level comment is NOT evidence.
    // The direction is safe (a thread stays open rather than being resolved on
    // thin evidence) and the pattern is core's, unchanged here
    // (packages/core/src/bot-identity.ts, mmnto-ai/totem#2800) — this test
    // exists so the limit is recorded, not so the behaviour looks correct.
    expect(
      toPrCommentRecords([{ id: 1, user: { login: 'coderabbit-fan', type: 'User' } }], identity)[0]
        ?.isBot,
    ).toBe(true);
    const result = await run({
      threads: [{ id: 'T', comments: [{ databaseId: 1, ...BOT_ROOT }] }],
      prComments: [{ login: 'coderabbit-fan', createdAt: '2026-09-08T04:00:00Z' }],
    });
    expect(result.rows[0]?.verdict).toBe('skip:no-evidence');
    // On the GRAPHQL surface the same human is NOT a bot (the exact list plus
    // `__typename: User`), so an in-thread reply from them WOULD be evidence.
    const [record] = toThreadRecords(
      [
        threadNode({
          id: 'T',
          comments: [BOT_ROOT, { login: 'coderabbit-fan', createdAt: '2026-09-08T04:00:00Z' }],
        }),
      ],
      identity,
    );
    expect(record?.humanReplyCount).toBe(1);
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

  // ── S3 / S3b: an App reply is not a human reply ──
  // The four review-bot logins are a CLOSED list, but any GitHub App can reply
  // in a review thread. Before the three-arm bot test these two cases resolved
  // the thread on the App's own comment — the fail-open direction.

  it('S3: a `github-actions` in-thread reply is NOT evidence (skip:no-evidence)', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-gha',
          comments: [
            { databaseId: 1, ...BOT_ROOT },
            // The GraphQL spelling of an App login carries no `[bot]` suffix —
            // `__typename` is the arm that catches it.
            {
              databaseId: 2,
              login: APP_NOT_A_REVIEW_BOT,
              typename: 'Bot',
              createdAt: '2026-09-08T04:00:00Z',
            },
          ],
        },
      ],
    });
    expect(result.rows[0]?.humanReplyCount).toBe(0);
    expect(result.rows.map((r) => [r.verdict, r.evidence])).toEqual([['skip:no-evidence', 'none']]);
  });

  it('S3b: a Copilot-reviewer in-thread reply is NOT evidence, on either spelling', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-copilot-typename',
          comments: [
            { databaseId: 1, ...BOT_ROOT },
            // An App outside core's list, caught by `__typename` alone.
            {
              databaseId: 2,
              login: 'copilot-pull-request-reviewer',
              typename: 'Bot',
              createdAt: '2026-09-08T04:00:00Z',
            },
          ],
        },
        {
          id: 'T-copilot-suffix',
          comments: [
            { databaseId: 3, ...BOT_ROOT },
            // Belt and braces: the `[bot]` suffix arm catches it even if a
            // future payload were to answer `User` for the typename.
            {
              databaseId: 4,
              login: 'copilot-pull-request-reviewer[bot]',
              typename: 'User',
              createdAt: '2026-09-08T04:00:00Z',
            },
          ],
        },
      ],
    });
    expect(result.rows.map((r) => r.verdict)).toEqual(['skip:no-evidence', 'skip:no-evidence']);
  });

  it('a HUMAN in-thread reply still resolves (the fold did not close the door on people)', async () => {
    const result = await run({
      threads: [
        {
          id: 'T-human-reply',
          comments: [
            { databaseId: 1, ...BOT_ROOT },
            { databaseId: 2, login: 'satur8d', createdAt: '2026-09-08T04:00:00Z' },
          ],
        },
      ],
    });
    expect(result.rows[0]?.humanReplyCount).toBe(1);
    expect(result.rows.map((r) => [r.verdict, r.evidence])).toEqual([
      ['resolve', 'in-thread-reply'],
    ]);
    expect(result.exitCode).toBe(0);
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

  it('dry-run (the default) performs zero mutations and sends only declared read shapes', async () => {
    const result = await run(evidenced);
    expect(mutationCalls(result.calls)).toHaveLength(0);
    // The allowlist, run over the dry-run too: every argv is a declared shape
    // AND none of them is the mutation.
    const shapes = assertOnlyDeclaredExecShapes(result.calls, { apply: false });
    expect(shapes).not.toContain('mutation');
    expect(new Set(shapes)).toEqual(
      new Set(['gh-version', 'repo-view', 'threads-read', 'issue-comments']),
    );
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

  it('every argv it sends is one of the six declared exec shapes (allowlist)', async () => {
    const result = await run(evidenced, { apply: true });
    const shapes = assertOnlyDeclaredExecShapes(result.calls, { apply: true });
    // The whole run is: the version probe, one repo read, one thread page, one
    // issue-comment read, two mutations. Nothing else was sent — not by
    // omission from a denylist, but because nothing else is representable in
    // the allowlist.
    expect(shapes).toEqual([
      'gh-version',
      'repo-view',
      'threads-read',
      'issue-comments',
      'mutation',
      'mutation',
    ]);
    expect(result.queries.filter((q) => q === RESOLVE_THREAD_MUTATION)).toHaveLength(2);
  });

  it('the allowlist REJECTS a write argv (the mutant check on the predicate itself)', () => {
    // If any of these passed, the allowlist would be decorative.
    const writes: string[][] = [
      ['pr', 'review', '2839', '--approve'],
      ['pr', 'comment', '2839', '--body', 'hi'],
      ['api', '-X', 'POST', 'repos/mmnto-ai/totem/issues/2839/comments'],
      ['api', '--method', 'PUT', 'repos/mmnto-ai/totem/pulls/2839/merge'],
      ['api', 'repos/mmnto-ai/totem/pulls/comments/1/replies', '-f', 'body=hi'],
      ['api', 'repos/mmnto-ai/totem/pulls/2839/reviews', '-f', 'event=APPROVE'],
      ['api', 'graphql', '-f', 'query=mutation { addComment(input: {}) { clientMutationId } }'],
      // The right document with a variable it never sends.
      ['api', 'graphql', '-f', `query=${RESOLVE_THREAD_MUTATION}`, '-f', 'body=hi'],
    ];
    for (const argv of writes) {
      expect(() => assertOnlyDeclaredExecShapes([argv], { apply: true })).toThrow();
    }
    // And the declared mutation is still refused when --apply was not passed.
    expect(() =>
      assertOnlyDeclaredExecShapes(
        [['api', 'graphql', '-f', `query=${RESOLVE_THREAD_MUTATION}`, '-f', 'threadId=T']],
        { apply: false },
      ),
    ).toThrow(/without --apply/);
    // A real read still passes, so the predicate is not simply always-throwing.
    expect(
      assertOnlyDeclaredExecShapes(
        [['api', 'repos/mmnto-ai/totem/issues/2839/comments', '--paginate']],
        { apply: false },
      ),
    ).toEqual(['issue-comments']);
  });

  it('a mutation that exits 0 without confirming isResolved is a FAILURE, not an applied row', async () => {
    const result = await run(
      {
        ...evidenced,
        // gh exits 0 and the body parses — but the payload carries no thread, so
        // nothing confirms the thread was resolved.
        mutationRawBody: { 'T-a': JSON.stringify({ data: { resolveReviewThread: null } }) },
      },
      { apply: true },
    );
    expect(result.rows.find((r) => r.threadId === 'T-a')?.applied).toBe(false);
    expect(result.rows.find((r) => r.threadId === 'T-a')?.errorText).toContain('no thread');
    expect(result.rows.find((r) => r.threadId === 'T-b')?.applied).toBe(true);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('1 thread(s) failed to resolve');
  });

  it('a mutation answering isResolved: false is a FAILURE — the thread is still open', async () => {
    const result = await run(
      {
        ...evidenced,
        mutationRawBody: {
          'T-a': JSON.stringify({
            data: { resolveReviewThread: { thread: { id: 'T-a', isResolved: false } } },
          }),
        },
      },
      { apply: true },
    );
    expect(result.rows.find((r) => r.threadId === 'T-a')?.applied).toBe(false);
    expect(result.rows.find((r) => r.threadId === 'T-a')?.errorText).toContain('still open');
    expect(result.exitCode).toBe(2);
  });

  it('confirmResolved refuses every unusable answer and accepts only a resolved thread', () => {
    expect(
      confirmResolved({ data: { resolveReviewThread: { thread: { id: 'T', isResolved: true } } } }),
    ).toEqual({ ok: true });
    expect(confirmResolved({ data: { resolveReviewThread: null } }).ok).toBe(false);
    expect(confirmResolved({ data: { resolveReviewThread: { thread: null } } }).ok).toBe(false);
    expect(confirmResolved({ data: {} }).ok).toBe(false);
    expect(confirmResolved('not json at all').ok).toBe(false);
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

  // The two NOT_FOUND fixtures below are the shape `gh` was OBSERVED to emit,
  // not an invented one: read-only on 2026-09-08 against mmnto-ai/totem,
  // `gh api graphql` for an absent PR number and for an absent repo each exited
  // **1** while printing a body carrying BOTH the null data and a NOT_FOUND
  // `errors` array. So the reachable arm is the non-zero-exit arm, and the line
  // it prints quotes GitHub's own message.

  it('fails hard when the PR is not found (gh exit 1 + a NOT_FOUND errors body)', async () => {
    const result = await run({
      threads: [],
      threadsExitCode: 1,
      threadsRawBody: JSON.stringify({
        data: { repository: { pullRequest: null } },
        errors: [
          {
            type: 'NOT_FOUND',
            path: ['repository', 'pullRequest'],
            message: 'Could not resolve to a PullRequest with the number of 2839.',
          },
        ],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('review threads NOT read — nothing resolved');
    expect(result.stderr).toContain('gh exited 1');
    expect(result.stderr).toContain('Could not resolve to a PullRequest');
    expect(mutationCalls(result.calls)).toHaveLength(0);
  });

  it('fails hard when the repository is inaccessible (gh exit 1 + a NOT_FOUND errors body)', async () => {
    const result = await run({
      threads: [],
      threadsExitCode: 1,
      threadsRawBody: JSON.stringify({
        data: { repository: null },
        errors: [
          {
            type: 'NOT_FOUND',
            path: ['repository'],
            message: "Could not resolve to a Repository with the name 'mmnto-ai/nope'.",
          },
        ],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not resolve to a Repository');
  });

  it('a 200 body with null data and NO errors is still a named hard failure (defence in depth)', async () => {
    // GitHub has not been observed to emit this (the NOT_FOUND path exits 1,
    // above) — a proxy or cache could. The arms exist so such a body is named
    // rather than read as "a PR with no threads", and this is what they print.
    const noPull = await run({
      threads: [],
      threadsRawBody: JSON.stringify({ data: { repository: { pullRequest: null } } }),
    });
    expect(noPull.exitCode).toBe(1);
    expect(noPull.stderr).toContain('PR #2839 not found');

    const noRepo = await run({
      threads: [],
      threadsRawBody: JSON.stringify({ data: { repository: null } }),
    });
    expect(noRepo.exitCode).toBe(1);
    expect(noRepo.stderr).toContain('not found or inaccessible');
  });

  it('a GraphQL errors array in a 200 body is a hard failure, never a partial read', async () => {
    const result = await run({
      threads: [],
      threadsRawBody: JSON.stringify({
        data: { repository: null },
        errors: [{ message: 'API rate limit exceeded' }],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('GraphQL errors');
    expect(result.stderr).toContain('API rate limit exceeded');
  });

  it('fails hard and names the cure when gh cannot resolve the repository', async () => {
    let stdout = '';
    let stderr = '';
    const calls: string[][] = [];
    const result = await resolveThreadsCommand('2839', {
      runner: (args: string[]) => {
        calls.push([...args]);
        // gh IS present (the probe answers); it is the repository read that
        // fails — an unauthenticated gh, the cure named is `gh auth status`.
        if (args[0] === '--version') return { stdout: 'gh version 2.99.0\n', exitCode: 0 };
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
    // It gave up on the FIRST call after the probe — no read, no mutation.
    expect(calls).toEqual([
      ['--version'],
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    ]);
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
    // The SUCCESS shape is as much a contract as the failure shape: pin the key
    // set exactly (so a field cannot be added or dropped unnoticed) and assert
    // every summary field, not just the one this fixture happens to exercise.
    expect(Object.keys(doc).sort()).toEqual(['apply', 'pr', 'repo', 'rows', 'summary']);
    expect(doc.repo).toBe('mmnto-ai/totem');
    expect(doc.pr).toBe(2839);
    expect(doc.apply).toBe(false);
    expect(doc.rows).toEqual(result.rows);
    expect(Object.keys(doc.summary).sort()).toEqual([
      'applied',
      'botRooted',
      'failed',
      'resolve',
      'skip:already-resolved',
      'skip:no-evidence',
      'skip:not-selected',
      'skip:outdated',
    ]);
    expect(doc.summary).toEqual({
      botRooted: 3,
      resolve: 3,
      'skip:already-resolved': 0,
      'skip:outdated': 0,
      'skip:no-evidence': 0,
      'skip:not-selected': 0,
      // Dry-run: nothing was attempted, so nothing applied and nothing failed —
      // `applied` is 0 here even though `resolve` is 3.
      applied: 0,
      failed: 0,
    });
  });

  it('--json under --apply reports what was applied and what failed', async () => {
    // The other half of the summary contract: `applied` counts the rows the
    // mutation CONFIRMED, and a per-thread failure shows up in `failed` rather
    // than silently inflating `applied`.
    const result = await run(
      {
        threads: [
          { id: 'T-a', comments: [{ databaseId: 11, ...BOT_ROOT }] },
          { id: 'T-b', comments: [{ databaseId: 21, ...BOT_ROOT }] },
        ],
        prComments: [{ login: 'satur8d', createdAt: '2026-09-08T04:05:00Z' }],
        mutationFailures: ['T-b'],
      },
      { apply: true, json: true },
    );
    const doc = JSON.parse(result.stdout) as {
      apply: boolean;
      summary: Record<string, number>;
    };
    expect(doc.apply).toBe(true);
    expect(doc.summary).toEqual({
      botRooted: 2,
      resolve: 2,
      'skip:already-resolved': 0,
      'skip:outdated': 0,
      'skip:no-evidence': 0,
      'skip:not-selected': 0,
      applied: 1,
      failed: 1,
    });
    expect(result.exitCode).toBe(2);
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

  it('--json emits the {error, rows, exitCode} document on a failure, and nothing else', async () => {
    // The failure shape is a CONTRACT for a script that reads --json: it is not
    // the success document with an added key, and `rows` is present (empty when
    // the failure predates the plan) so a consumer can read it unconditionally.
    const readFailed = await run({ threads: [], threadsExitCode: 1 }, { json: true });
    const failDoc = JSON.parse(readFailed.stdout) as Record<string, unknown>;
    expect(Object.keys(failDoc).sort()).toEqual(['error', 'exitCode', 'rows']);
    expect(typeof failDoc['error']).toBe('string');
    expect(failDoc['rows']).toEqual([]);
    expect(failDoc['exitCode']).toBe(1);

    // The unmatched-id abort carries the SAME shape, with the rows it had built.
    const unmatched = await run(CAPTURE_2839, { json: true, ids: '999999' });
    const idDoc = JSON.parse(unmatched.stdout) as { rows: ResolveThreadsRow[]; exitCode: number };
    expect(Object.keys(idDoc).sort()).toEqual(['error', 'exitCode', 'rows']);
    expect(idDoc.exitCode).toBe(2);
    expect(idDoc.rows).toHaveLength(3);
  });

  it('gh absent fails IN CONTRACT — the text line in text mode, the {error, rows, exitCode} document under --json, and no further gh call (PR round 1, greptile)', async () => {
    // The precondition used to be an action-level `process.exit(1)` before the
    // command ran, which gave a `--json` script nothing to parse. The probe now
    // goes through the seam: it is the FIRST and only call when gh is missing.
    const text = await run({ threads: [], ghVersionExitCode: 127 });
    expect(text.exitCode).toBe(1);
    expect(text.stderr).toMatch(/requires the GitHub CLI \(gh\)/);
    expect(text.stdout).toBe('');
    expect(text.calls).toEqual([['--version']]);

    const json = await run({ threads: [], ghVersionExitCode: 127 }, { json: true });
    expect(json.exitCode).toBe(1);
    const doc = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(Object.keys(doc).sort()).toEqual(['error', 'exitCode', 'rows']);
    expect(doc['error']).toMatch(/requires the GitHub CLI/);
    expect(doc['rows']).toEqual([]);
    expect(doc['exitCode']).toBe(1);
    expect(json.calls).toEqual([['--version']]);
  });

  it('MAX_PAGES exhaustion on the thread read fails closed — exit 1, no rows, no mutation (PR round 1, CodeRabbit)', async () => {
    // Every page reports a followable next page, so the read can never
    // complete; the cap is the floor against an endless walk, and it is a
    // named hard failure, never a partial plan.
    const result = await run(
      {
        threads: [{ id: 'T-1', comments: [{ databaseId: 1, ...BOT_ROOT }] }],
        threadsAlwaysHasNext: true,
      },
      { apply: true },
    );
    expect(result.exitCode).toBe(1);
    expect(result.rows).toEqual([]);
    expect(result.stderr).toMatch(/more review threads than 20 pages/);
    expect(mutationCalls(result.calls)).toHaveLength(0);
    // The probe, the repo read, then exactly MAX_PAGES thread pages.
    expect(
      result.calls.filter((c) => c.some((a) => a.includes('TotemResolveThreads'))).length,
    ).toBe(20);
  });

  it("MAX_PAGES exhaustion on a thread's comment continuation fails closed the same way (PR round 1, CodeRabbit)", async () => {
    const result = await run(
      {
        threads: [
          {
            id: 'T-1',
            commentsHasNext: true,
            commentsCursor: 'c1',
            comments: [{ databaseId: 1, ...BOT_ROOT }],
          },
        ],
        commentsAlwaysHasNext: true,
      },
      { apply: true },
    );
    expect(result.exitCode).toBe(1);
    expect(result.rows).toEqual([]);
    expect(result.stderr).toMatch(/more comments than 20 pages/);
    expect(mutationCalls(result.calls)).toHaveLength(0);
    expect(
      result.calls.filter((c) => c.some((a) => a.includes('TotemResolveThreadComments'))).length,
    ).toBe(20);
  });

  it('refuses a non-numeric PR argument before any gh call', async () => {
    const result = await run(CAPTURE_2839, { pr: 'main' });
    expect(result.exitCode).toBe(1);
    expect(result.calls).toHaveLength(0);
  });
});
