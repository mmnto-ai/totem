/**
 * `totem resolve-threads <pr>` — resolve the bot review threads a round has
 * already dispositioned (mmnto-ai/totem#2841, rulings R1-R4 in
 * `.totem/specs/2841.md`).
 *
 * WHY IT EXISTS: the merge-ready gate's predicate 2 (mmnto-ai/totem#2800)
 * denies a merge while any unresolved, non-outdated review thread rooted by a
 * known review bot is open. The lawful way past it is to RESOLVE the threads a
 * round has answered — not to silence the predicate. This verb does exactly
 * that, deterministically and with zero LLM calls.
 *
 * THE EVIDENCE RULE (R2 verbatim): "An in-thread human reply OR a human
 * PR-level comment created after the thread's root — either suffices." So:
 *   - `in-thread-reply`: a comment after the root whose author is not a bot
 *     (the CodeRabbit/Greptile routine); or
 *   - `pr-level-disposition`: ANY non-bot PR-level (issue) comment created
 *     AFTER the thread's root comment. It is NOT keyed to the round-disposition
 *     comment specifically — the rule is any non-bot comment that postdates the
 *     root, because a PR-level comment is the only lawful answer to a GCA
 *     thread (bot-protocols forbids replying to GCA in-thread) and no
 *     deterministic reading distinguishes a disposition from other human prose.
 *     CONSEQUENCE, stated because it is load-bearing: on a re-invoked round the
 *     operator's trigger comment ("@coderabbitai review") is itself non-bot
 *     evidence for every thread it postdates — which is exactly why the round
 *     disposition must be posted BEFORE this verb runs (the review-reply
 *     skill's step 4 ordering), not after.
 * A thread with neither is a `skip:no-evidence` row and is NEVER resolved,
 * under any flag. There is no override.
 *
 * WHAT COUNTS AS A BOT, on each surface (the fail-open trap this holds shut):
 * the four review-bot logins are core's closed list, but ANY GitHub App can
 * comment — `github-actions[bot]`, a Copilot reviewer, a scanner — and an App's
 * comment is not a human answer. So a comment is a bot's when GraphQL says
 * `author.__typename === 'Bot'`, or the login ends in `[bot]`, or it is on
 * core's exact list; on REST, when `user.type === 'Bot'`, or the login ends in
 * `[bot]`, or core's loose review-bot pattern matches. Only what survives all
 * three arms is evidence. A DELETED account (null author) is deliberately NOT a
 * bot: the reply it left was a human reply when it was written, and deleting
 * the account does not retract it (recorded as item (6) of the design's
 * disagreement list in `.totem/specs/2841.md`).
 *
 * SAFETY PROPERTIES this module holds:
 *   - Dry-run by DEFAULT. `--apply` is the only path that mutates.
 *   - The verb NEVER posts a comment, a reply or a review. The only mutation it
 *     can issue is `resolveReviewThread`.
 *   - A read that could not be completed (a `hasNextPage` it cannot follow, a
 *     page budget blown, a `gh` failure, a GraphQL `errors` body) is a HARD
 *     failure — exit 1, nothing resolved. Never a shorter list silently
 *     treated as the whole PR (the no-silent-shrink rule the spine reader and
 *     merge-ready both hold).
 *   - A human-rooted thread is never a candidate, whatever its state.
 *   - Every bot-rooted thread prints exactly one row carrying its REST root
 *     comment id (R4), so nothing is skipped silently.
 *
 * Every `gh` call goes through the injected {@link GhRunner} seam (the
 * mmnto-ai/totem#2800 shape: argv in, `{ stdout, exitCode }` out — never a
 * shell string), so the tests run fully offline against checked-in captures.
 */

import { z } from 'zod';

// Value imports from '@mmnto/totem' are dynamic, inside the command body
// (mmnto-ai/totem#2339 — the core barrel pulls LanceDB into every startup).
// Type-only imports are erased at build, so they stay static.
import type { GhRunner } from '@mmnto/totem';

// ─── Named constants ─────────────────────────────────────────────────────────

/** Page size for every paginated connection in the read. */
const PAGE_SIZE = 100;

/**
 * Hard cap on GraphQL round trips per connection. A PR needing more pages than
 * this is a FAILED read (named, exit 1), never "clean by exhaustion" — the same
 * capped-read bar merge-ready holds.
 */
const MAX_PAGES = 20;

/** `gh` exec timeout (ms) for the default runner. */
const GH_TIMEOUT_MS = 60_000;

/** 10MB — a fully paginated issue-comment read on a busy PR stays well inside. */
const GH_MAX_BUFFER = 10 * 1024 * 1024;

// ─── The read surface (one query per connection, explicit cursors) ───────────

/**
 * The thread read. `comments(first:)` carries `databaseId` — the REST comment
 * id `totem triage-pr` prints as a finding's `rootCommentId`, which is what
 * `--ids` selects on and what every row prints (R4).
 */
export const RESOLVE_THREADS_QUERY = `query TotemResolveThreads($owner: String!, $name: String!, $number: Int!, $threadsAfter: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${PAGE_SIZE}, after: $threadsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          comments(first: ${PAGE_SIZE}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              databaseId
              author { __typename login }
              createdAt
            }
          }
        }
      }
    }
  }
}`;

/**
 * The per-thread comment continuation. A nested connection cannot be paged from
 * the outer document (one cursor cannot address many threads), so a thread that
 * reports `comments.pageInfo.hasNextPage` is followed by node id until it is
 * complete. A page that cannot be followed is a failed read, not a short list.
 */
export const RESOLVE_THREAD_COMMENTS_QUERY = `query TotemResolveThreadComments($threadId: ID!, $commentsAfter: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      comments(first: ${PAGE_SIZE}, after: $commentsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          databaseId
          author { __typename login }
          createdAt
        }
      }
    }
  }
}`;

/**
 * The ONLY mutation this verb can issue. It asks the thread back with
 * `isResolved` so the run can CONFIRM the outcome rather than infer it from a
 * clean exit (see {@link confirmResolved}).
 */
export const RESOLVE_THREAD_MUTATION = `mutation TotemResolveReviewThread($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread { id isResolved }
  }
}`;

// ─── Zod at the IO boundary ──────────────────────────────────────────────────

const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

/**
 * `author` is null for a deleted/ghost account — never coerced to a bot.
 * `__typename` is REQUIRED, not optional: both documents select it, and it is
 * the only signal that catches a GitHub App outside core's four-name review-bot
 * list (`github-actions`, a Copilot reviewer, a scanner). Making it optional
 * would let a document that quietly stopped selecting it fail OPEN — every App
 * reply reading as a human reply. Absent ⇒ the read fails loud instead.
 */
const GqlCommentSchema = z.object({
  databaseId: z.number().nullable(),
  author: z.object({ __typename: z.string(), login: z.string() }).nullable(),
  createdAt: z.string(),
});

const GqlThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  comments: z.object({ pageInfo: PageInfoSchema, nodes: z.array(GqlCommentSchema) }),
});

const ThreadsPageSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            reviewThreads: z.object({
              pageInfo: PageInfoSchema,
              nodes: z.array(GqlThreadSchema),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

/** The mutation's answer. `thread.isResolved` is what makes a row `applied`. */
const ResolveMutationSchema = z.object({
  data: z.object({
    resolveReviewThread: z
      .object({ thread: z.object({ id: z.string(), isResolved: z.boolean() }).nullable() })
      .nullable(),
  }),
});

const CommentsPageSchema = z.object({
  data: z.object({
    node: z
      .object({
        comments: z.object({ pageInfo: PageInfoSchema, nodes: z.array(GqlCommentSchema) }),
      })
      .nullable(),
  }),
});

/** A GraphQL body can carry `errors` beside (or instead of) `data`. */
const GqlErrorsSchema = z.object({
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

/**
 * The REST issue-comment shape. `user.login` keeps its `[bot]` suffix on this
 * surface and `user.type` is `Bot` for every GitHub App — both are read, so an
 * app comment can never pass as the human disposition.
 */
const RestIssueCommentSchema = z.object({
  id: z.number(),
  user: z.object({ login: z.string(), type: z.string() }).nullable(),
  created_at: z.string().optional(),
});

/** One validated GraphQL review-thread node (the reader's own shape). */
export type ReviewThreadNode = z.infer<typeof GqlThreadSchema>;
/** One validated GraphQL review-thread comment node. */
export type ReviewCommentNode = z.infer<typeof GqlCommentSchema>;
/** One validated REST issue comment (the PR-level surface). */
export type RestIssueComment = z.infer<typeof RestIssueCommentSchema>;

// ─── Data model ──────────────────────────────────────────────────────────────

/** One PR review thread, reduced to what the selector reads. */
export interface ReviewThreadRecord {
  /** The GraphQL node id (`PRRT_…`) the mutation takes. */
  id: string;
  /**
   * `PullRequestReviewComment.databaseId` of the FIRST comment — the REST id
   * `totem triage-pr` carries as a finding's `rootCommentId`. Null only when
   * GitHub answered no id (an `--ids` entry can then never match the row).
   */
  rootCommentId: number | null;
  /** The root comment's `author.login` (GraphQL spelling, no `[bot]`), or null for a deleted account. */
  rootAuthor: string | null;
  /** The root comment's `createdAt` — the instant PR-level evidence must post AFTER. */
  rootCreatedAt: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  /** Comments after the root whose author is NOT a known review bot (a null author counts). */
  humanReplyCount: number;
}

/** One PR-level (issue) comment, reduced to what the evidence rule reads. */
export interface PrIssueCommentRecord {
  author: string;
  /** True for a GitHub App (`user.type === 'Bot'`, a `[bot]` login, or a known review bot). */
  isBot: boolean;
  createdAt: string | null;
}

/** How the round answered a thread. `none` is never resolvable. */
export type DispositionEvidence = 'in-thread-reply' | 'pr-level-disposition' | 'none';

/** What the plan says will happen (or did) to one bot-rooted thread. */
export type ResolveThreadsVerdict =
  | 'resolve'
  | 'skip:already-resolved'
  | 'skip:outdated'
  | 'skip:no-evidence'
  | 'skip:not-selected';

/** One printed row. `--json` carries exactly these fields. */
export interface ResolveThreadsRow {
  threadId: string;
  rootCommentId: number | null;
  rootAuthor: string | null;
  rootCreatedAt: string;
  path: string;
  isResolved: boolean;
  isOutdated: boolean;
  humanReplyCount: number;
  evidence: DispositionEvidence;
  verdict: ResolveThreadsVerdict;
  /** null under dry-run (nothing was attempted); true/false once `--apply` ran the mutation. */
  applied: boolean | null;
  /** The mutation's failure text when `applied` is false. */
  errorText: string | null;
}

/**
 * The two identity predicates, injected so the pure selector stays free of the
 * heavy core barrel (mmnto-ai/totem#2339) and the tests exercise the SHIPPED
 * classification rather than a copy. Both come from
 * `packages/core/src/bot-identity.ts` (mmnto-ai/totem#2800), the one definition.
 */
export interface BotIdentityPredicates {
  /**
   * The GraphQL surface: `isBotReviewerLoginExact` — a CLOSED-list membership
   * test over a login spelled WITHOUT the `[bot]` suffix. Exact, never a
   * pattern, so no human account can be read as a bot.
   */
  isBotLoginExact: (login: string) => boolean;
  /** The REST surface: `isBotReviewerLogin` — the loose pattern over a `name[bot]` login. */
  isBotLoginLoose: (login: string) => boolean;
}

/** Options for {@link resolveThreadsCommand}. */
export interface ResolveThreadsOptions {
  /** Run the `resolveReviewThread` mutation. Absent = dry-run (the default). */
  apply?: boolean;
  /** Comma-separated REST root comment ids narrowing the batch (R4). Unmatched entries abort. */
  ids?: string;
  /** Emit one JSON document instead of the human rows. */
  json?: boolean;
  /** Working directory for the default `gh` runner. */
  cwd?: string;
  /** Injectable `gh` seam (tests). Defaults to a `gh`-backed spawn. */
  runner?: GhRunner;
  /** stdout sink (tests). */
  out?: (text: string) => void;
  /** stderr sink (tests). */
  err?: (text: string) => void;
}

/** What one run produced. */
export interface ResolveThreadsResult {
  exitCode: 0 | 1 | 2;
  rows: ResolveThreadsRow[];
}

// ─── Pure mapping + selection ────────────────────────────────────────────────

/** A login spelled the REST way (`name[bot]`) — the App suffix, on any surface. */
const BOT_LOGIN_SUFFIX = /\[bot\]$/i;

/**
 * Is this GraphQL comment written by a bot? THREE arms, because core's
 * review-bot list is a closed list of four and any GitHub App can reply in a
 * thread: GitHub's own `author.__typename === 'Bot'` (the authoritative
 * signal — verified 2026-09-08T06:03:03Z on mmnto-ai/totem#2839, where
 * `greptile-apps` and `coderabbitai` both answer `Bot` with no `[bot]` suffix
 * on the login), a `[bot]`-suffixed login, or core's exact review-bot list.
 * Anything narrower fails OPEN: a `github-actions[bot]` or Copilot-reviewer
 * comment would count as the human reply and resolve the thread.
 *
 * A null author (deleted/ghost account) is deliberately NOT a bot — the reply
 * it left was a human reply when it was written, and deleting the account does
 * not retract it. So such a comment still counts as evidence, while such a ROOT
 * is not a bot root and its thread is not a candidate at all.
 */
function isBotComment(comment: ReviewCommentNode, identity: BotIdentityPredicates): boolean {
  const author = comment.author;
  if (author === null) return false;
  if (author.__typename === 'Bot') return true;
  if (BOT_LOGIN_SUFFIX.test(author.login)) return true;
  return identity.isBotLoginExact(author.login);
}

/**
 * Reduce validated GraphQL threads to {@link ReviewThreadRecord}s. Pure given
 * `identity`. The ENTIRE comment list is inspected — human comments are never
 * filtered out before the classification, because whether a human replied is
 * exactly what the evidence rule reads.
 */
export function toThreadRecords(
  threads: readonly ReviewThreadNode[],
  identity: BotIdentityPredicates,
): ReviewThreadRecord[] {
  return threads.map((t) => {
    const [root, ...replies] = t.comments.nodes;
    return {
      id: t.id,
      rootCommentId: root?.databaseId ?? null,
      rootAuthor: root?.author?.login ?? null,
      rootCreatedAt: root?.createdAt ?? '',
      isResolved: t.isResolved,
      isOutdated: t.isOutdated,
      path: t.path,
      humanReplyCount: replies.filter((c) => !isBotComment(c, identity)).length,
    };
  });
}

/**
 * Is this thread rooted by a review bot? Only bot-rooted threads are candidates
 * (and only they print a row) — a human-rooted thread is never resolved by this
 * verb, whatever its state.
 */
export function isBotRootedThread(
  record: ReviewThreadRecord,
  identity: BotIdentityPredicates,
): boolean {
  // The ROOT test stays core's EXACT four-name list, deliberately narrower than
  // {@link isBotComment}'s three arms: predicate 2 of merge-ready denies on a
  // thread rooted by a KNOWN REVIEW BOT, and this verb exists to clear exactly
  // those. Widening it to every App would have the verb resolving threads the
  // gate never denied on.
  return record.rootAuthor !== null && identity.isBotLoginExact(record.rootAuthor);
}

/**
 * Reduce validated REST issue comments to {@link PrIssueCommentRecord}s. Pure
 * given `identity`. The bot test is the REST mirror of {@link isBotComment}'s
 * three arms: GitHub's `user.type === 'Bot'` (every App), a `[bot]`-suffixed
 * login, or core's LOOSE review-bot pattern (the REST surface's own test).
 * A null user (deleted account) is not a bot, for the same reason a null
 * GraphQL author is not.
 */
export function toPrCommentRecords(
  comments: readonly RestIssueComment[],
  identity: BotIdentityPredicates,
): PrIssueCommentRecord[] {
  return comments.map((c) => {
    const login = c.user?.login ?? '';
    const isBot =
      c.user !== null &&
      (c.user.type === 'Bot' || BOT_LOGIN_SUFFIX.test(login) || identity.isBotLoginLoose(login));
    return { author: login, isBot, createdAt: c.created_at ?? null };
  });
}

/**
 * Derive the evidence for one thread (R2). An in-thread human reply wins; else
 * a non-bot PR-level comment created strictly AFTER the thread's root; else
 * `none`. An unparseable instant on either side is not evidence — the
 * conservative direction, since `none` can only ever refuse to resolve.
 */
export function deriveEvidence(
  record: ReviewThreadRecord,
  prComments: readonly PrIssueCommentRecord[],
): DispositionEvidence {
  if (record.humanReplyCount > 0) return 'in-thread-reply';
  const rootAt = Date.parse(record.rootCreatedAt);
  if (Number.isNaN(rootAt)) return 'none';
  for (const c of prComments) {
    if (c.isBot || c.createdAt === null) continue;
    const at = Date.parse(c.createdAt);
    if (!Number.isNaN(at) && at > rootAt) return 'pr-level-disposition';
  }
  return 'none';
}

/**
 * The verdict for one candidate thread. PRECEDENCE, most-informative first: an
 * already-resolved or outdated thread reports THAT (it is the fact the operator
 * needs, and neither is ever mutated), then non-selection, then the evidence
 * rule. Only `resolve` ever reaches the mutation.
 */
export function classifyThread(
  record: ReviewThreadRecord,
  evidence: DispositionEvidence,
  selected: boolean,
): ResolveThreadsVerdict {
  if (record.isResolved) return 'skip:already-resolved';
  if (record.isOutdated) return 'skip:outdated';
  if (!selected) return 'skip:not-selected';
  return evidence === 'none' ? 'skip:no-evidence' : 'resolve';
}

/** The parsed `--ids` selection, or the error that aborts the run. */
export type IdSelection =
  | { ok: true; ids: readonly number[] | null }
  | { ok: false; invalid: readonly string[] };

/**
 * Parse `--ids`. `null` (the option absent or empty) means "every evidenced bot
 * thread" — the default (R4). A malformed entry aborts the run exactly like an
 * unmatched one: a typo must never silently narrow the batch.
 */
export function parseIdSelection(raw: string | undefined): IdSelection {
  if (raw === undefined) return { ok: true, ids: null };
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e !== '');
  if (entries.length === 0) return { ok: true, ids: null };
  const ids: number[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const digits = entry.startsWith('#') ? entry.slice(1) : entry;
    if (!/^[0-9]+$/.test(digits)) {
      invalid.push(entry);
      continue;
    }
    ids.push(Number(digits));
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, ids };
}

/** The plan: one row per bot-rooted thread, plus any selected id that matched nothing. */
export interface ResolveThreadsPlan {
  rows: ResolveThreadsRow[];
  /** Selected ids matching no bot-rooted thread. Non-empty ⇒ abort before any mutation. */
  unmatchedIds: number[];
}

/**
 * Build the plan. Pure. Every bot-rooted thread yields exactly one row; a
 * human-rooted thread yields none.
 */
export function buildResolveThreadsPlan(
  records: readonly ReviewThreadRecord[],
  prComments: readonly PrIssueCommentRecord[],
  identity: BotIdentityPredicates,
  selectedIds: readonly number[] | null,
): ResolveThreadsPlan {
  const candidates = records.filter((r) => isBotRootedThread(r, identity));
  const matched = new Set<number>();
  const rows = candidates.map((record) => {
    const selected =
      selectedIds === null ||
      (record.rootCommentId !== null && selectedIds.includes(record.rootCommentId));
    if (selected && selectedIds !== null && record.rootCommentId !== null) {
      matched.add(record.rootCommentId);
    }
    const evidence = deriveEvidence(record, prComments);
    return {
      threadId: record.id,
      rootCommentId: record.rootCommentId,
      rootAuthor: record.rootAuthor,
      rootCreatedAt: record.rootCreatedAt,
      path: record.path,
      isResolved: record.isResolved,
      isOutdated: record.isOutdated,
      humanReplyCount: record.humanReplyCount,
      evidence,
      verdict: classifyThread(record, evidence, selected),
      applied: null,
      errorText: null,
    } satisfies ResolveThreadsRow;
  });
  const unmatchedIds = selectedIds === null ? [] : selectedIds.filter((id) => !matched.has(id));
  return { rows, unmatchedIds };
}

// ─── The gh seam ─────────────────────────────────────────────────────────────

/**
 * Build the default `gh`-backed runner. A spawn failure (gh absent) and a
 * non-zero exit arrive the same way — as a read that did not answer, carrying
 * what `gh` said — so the caller can NAME it instead of losing the text in a
 * generic error boundary. Nothing here can return a clean read.
 */
async function defaultRunner(cwd: string): Promise<GhRunner> {
  const { safeExec } = await import('@mmnto/totem');
  return (args: string[]) => {
    // totem-context: NOT a swallowed error — the seam's contract is
    // `{ stdout, exitCode }` (the mmnto-ai/totem#2800 GhRunner shape). A gh that
    // did not answer becomes a NAMED hard failure at the call site (exit 1,
    // nothing resolved); it is never converted into a clean or partial read.
    try {
      return {
        stdout: safeExec('gh', args, {
          cwd,
          timeout: GH_TIMEOUT_MS,
          maxBuffer: GH_MAX_BUFFER,
          trim: false,
          env: { ...process.env, GH_PROMPT_DISABLED: '1' },
        }),
        exitCode: 0,
      };
      // totem-context: intentional — see the directive above the try; the failure is reified into the seam's contract and named by the caller, never silently degraded.
    } catch (err) {
      // totem-context: intentional — a gh that did not answer is reified into `{ stdout, exitCode }` and becomes a named hard failure (exit 1); never a clean read.
      const fields = err as { status?: number | null; stdout?: string; stderr?: string };
      const stdout = fields.stdout?.trim();
      const stderr = fields.stderr?.trim();
      const text =
        stdout !== undefined && stdout !== ''
          ? stdout
          : stderr !== undefined && stderr !== ''
            ? stderr
            : err instanceof Error
              ? err.message
              : String(err);
      return { stdout: text, exitCode: typeof fields.status === 'number' ? fields.status : 1 };
    }
  };
}

/** Build the argv for a `gh api graphql` call. Never a shell string. */
export function graphqlArgs(
  query: string,
  variables: ReadonlyArray<readonly [string, string | number]>,
): string[] {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of variables) {
    // `-F` sends a typed value (an `Int!` argument requires it); `-f` a string.
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  }
  return args;
}

/** Bound any quoted failure text so one bad body cannot flood the transcript. */
function bounded(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

type ReadFailure = { ok: false; detail: string };

/** Run one `gh` call and JSON-parse it, checking the GraphQL `errors` array. */
function runJson(
  runner: GhRunner,
  args: readonly string[],
  what: string,
): { ok: true; body: unknown } | ReadFailure {
  const run = runner([...args]);
  if (run.exitCode !== 0) {
    return { ok: false, detail: `${what}: gh exited ${run.exitCode}: ${bounded(run.stdout)}` };
  }
  let body: unknown;
  // totem-context: NOT a swallowed error — the parse failure is reified into the
  // discriminated ReadFailure and becomes a named hard failure (exit 1, nothing
  // resolved) at the call site. Throwing here would lose the body text.
  try {
    body = JSON.parse(run.stdout);
    // totem-context: intentional — the unparseable body is reified into ReadFailure and named; never treated as an empty or partial read.
  } catch (err) {
    // totem-context: intentional — the unparseable body is reified into ReadFailure and named; never treated as an empty or partial read.
    return {
      ok: false,
      detail: `${what}: response was not JSON (${err instanceof Error ? err.message : String(err)}): ${bounded(run.stdout)}`,
    };
  }
  const errors = GqlErrorsSchema.safeParse(body);
  if (errors.success && errors.data.errors !== undefined && errors.data.errors.length > 0) {
    return {
      ok: false,
      detail: `${what}: GraphQL errors: ${bounded(errors.data.errors.map((e) => e.message).join('; '))}`,
    };
  }
  return { ok: true, body };
}

// ─── The reads ───────────────────────────────────────────────────────────────

type ThreadsRead = { ok: true; threads: ReviewThreadNode[] } | ReadFailure;

/**
 * Read every review thread on the PR, following BOTH connections' cursors.
 * Any page that cannot be followed — no cursor, the budget blown, a failed or
 * unparseable response — fails the whole read. There is no arm that returns a
 * partial thread set.
 */
export function readReviewThreads(
  runner: GhRunner,
  owner: string,
  name: string,
  pr: number,
): ThreadsRead {
  const threads: ReviewThreadNode[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const variables: Array<readonly [string, string | number]> = [
      ['owner', owner],
      ['name', name],
      ['number', pr],
    ];
    if (cursor !== null) variables.push(['threadsAfter', cursor]);

    const run = runJson(
      runner,
      graphqlArgs(RESOLVE_THREADS_QUERY, variables),
      `review threads page ${page + 1}`,
    );
    if (!run.ok) return run;

    const parsed = ThreadsPageSchema.safeParse(run.body);
    if (!parsed.success) {
      return {
        ok: false,
        detail: `review threads page ${page + 1} did not match the expected shape: ${bounded(parsed.error.message)}`,
      };
    }
    const repo = parsed.data.data.repository;
    if (repo === null) {
      return { ok: false, detail: `repository ${owner}/${name} not found or inaccessible` };
    }
    const pull = repo.pullRequest;
    if (pull === null) {
      return { ok: false, detail: `PR #${pr} not found in ${owner}/${name}` };
    }

    threads.push(...pull.reviewThreads.nodes);
    const info = pull.reviewThreads.pageInfo;
    if (!info.hasNextPage) {
      const completed = completeThreadComments(runner, threads);
      return completed.ok ? { ok: true, threads } : completed;
    }
    if (info.endCursor === null) {
      return {
        ok: false,
        detail: `PR #${pr} reports more review threads but returned no cursor to follow (page ${page + 1})`,
      };
    }
    cursor = info.endCursor;
  }

  return {
    ok: false,
    detail: `PR #${pr} has more review threads than ${MAX_PAGES} pages of ${PAGE_SIZE} — the read is incomplete, so nothing was resolved`,
  };
}

/**
 * Follow each thread's comment cursor until every comment is in hand. Mutates
 * the passed nodes in place (they are this module's own parsed copies).
 */
function completeThreadComments(
  runner: GhRunner,
  threads: readonly ReviewThreadNode[],
): { ok: true } | ReadFailure {
  for (const thread of threads) {
    let info = thread.comments.pageInfo;
    for (let page = 0; info.hasNextPage; page++) {
      if (page >= MAX_PAGES) {
        return {
          ok: false,
          detail: `thread ${thread.id} has more comments than ${MAX_PAGES} pages of ${PAGE_SIZE} — the read is incomplete, so nothing was resolved`,
        };
      }
      if (info.endCursor === null) {
        return {
          ok: false,
          detail: `thread ${thread.id} reports more comments but returned no cursor to follow`,
        };
      }
      const run = runJson(
        runner,
        graphqlArgs(RESOLVE_THREAD_COMMENTS_QUERY, [
          ['threadId', thread.id],
          ['commentsAfter', info.endCursor],
        ]),
        `comments of thread ${thread.id}`,
      );
      if (!run.ok) return run;
      const parsed = CommentsPageSchema.safeParse(run.body);
      if (!parsed.success) {
        return {
          ok: false,
          detail: `comments of thread ${thread.id} did not match the expected shape: ${bounded(parsed.error.message)}`,
        };
      }
      const node = parsed.data.data.node;
      if (node === null) {
        return { ok: false, detail: `thread ${thread.id} could not be read back by node id` };
      }
      thread.comments.nodes.push(...node.comments.nodes);
      info = node.comments.pageInfo;
    }
  }
  return { ok: true };
}

type PrCommentsRead = { ok: true; comments: RestIssueComment[] } | ReadFailure;

/**
 * Read the PR's issue comments (REST, `--paginate`). This is the surface where
 * a login keeps its `[bot]` suffix and `user.type` is available, so a bot's own
 * PR-level comment can never be read as the human disposition. A failure here
 * is a HARD failure: evidence cannot be derived, so no thread may be resolved.
 */
export function readPrIssueComments(
  runner: GhRunner,
  owner: string,
  name: string,
  pr: number,
): PrCommentsRead {
  const run = runJson(
    runner,
    ['api', `repos/${owner}/${name}/issues/${pr}/comments`, '--paginate'],
    `PR-level comments on #${pr}`,
  );
  if (!run.ok) return run;
  const parsed = z.array(RestIssueCommentSchema).safeParse(run.body);
  if (!parsed.success) {
    return {
      ok: false,
      detail: `PR-level comments on #${pr} did not match the expected shape: ${bounded(parsed.error.message)}`,
    };
  }
  return { ok: true, comments: parsed.data };
}

/**
 * Did the mutation actually resolve the thread? `gh` exiting 0 says only that a
 * request was answered; the ANSWER has to say `isResolved: true`. A null
 * payload, a null thread, `isResolved: false`, or a body that does not parse
 * are each a named per-thread failure — a row is never marked applied on a
 * mutation whose result was not read back.
 */
export function confirmResolved(body: unknown): { ok: true } | { ok: false; detail: string } {
  const parsed = ResolveMutationSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      detail: `the resolveReviewThread response did not match the expected shape: ${bounded(parsed.error.message)}`,
    };
  }
  const thread = parsed.data.data.resolveReviewThread?.thread ?? null;
  if (thread === null) {
    return { ok: false, detail: 'the resolveReviewThread response carried no thread' };
  }
  if (!thread.isResolved) {
    return {
      ok: false,
      detail: `GitHub answered isResolved: false for ${thread.id} — the thread is still open`,
    };
  }
  return { ok: true };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

const VERDICT_WIDTH = 'skip:already-resolved'.length;

/** One printed row. The REST root comment id is on EVERY row (R4). */
export function formatRow(row: ResolveThreadsRow): string {
  const id = row.rootCommentId === null ? 'id=unknown' : `id=${row.rootCommentId}`;
  const author = row.rootAuthor ?? '(deleted account)';
  const parts = [
    row.verdict.padEnd(VERDICT_WIDTH),
    id,
    author,
    `evidence=${row.evidence}`,
    row.path,
  ];
  return parts.join('  ');
}

/** The one-line cure a `skip:no-evidence` row carries — both lawful ways to give it evidence. */
const NO_EVIDENCE_HINT =
  'give it evidence — reply in the thread, or post the round-disposition PR comment AFTER the thread root — then re-run';

// ─── The command ─────────────────────────────────────────────────────────────

/**
 * Run the verb. Returns the exit code rather than exiting, so `index.ts` owns
 * `process.exitCode` (the `pr merge` / `mail` convention).
 *
 * EXIT CODES:
 *   0 — the plan printed, or `--apply` resolved everything it planned to
 *   1 — a hard read failure (nothing resolved), or `gh` did not answer
 *   2 — an unmatched `--ids` entry (nothing resolved); a mutation that failed;
 *       or, under `--apply`, a SELECTED thread skipped for want of evidence
 *       (the run did not do what was asked)
 */
export async function resolveThreadsCommand(
  prArg: string,
  opts: ResolveThreadsOptions = {},
): Promise<ResolveThreadsResult> {
  const out = opts.out ?? ((t: string) => process.stdout.write(t));
  const err = opts.err ?? ((t: string) => process.stderr.write(t));
  const json = opts.json === true;
  const apply = opts.apply === true;
  const emit = (line: string): void => {
    if (!json) out(`${line}\n`);
  };
  const fail = (detail: string, exitCode: 1 | 2, rows: ResolveThreadsRow[] = []): void => {
    err(`[Totem Error] ${detail}\n`);
    if (json) out(`${JSON.stringify({ error: detail, rows, exitCode }, null, 2)}\n`);
  };

  const pr = Number(prArg.trim().replace(/^#/, ''));
  if (!Number.isInteger(pr) || pr <= 0) {
    fail(`"${prArg}" is not a pull-request number`, 1);
    return { exitCode: 1, rows: [] };
  }

  const selection = parseIdSelection(opts.ids);
  if (!selection.ok) {
    fail(
      `--ids carries ${selection.invalid.length} entry/entries that are not REST comment ids: ${selection.invalid.join(', ')} — nothing was resolved`,
      2,
    );
    return { exitCode: 2, rows: [] };
  }

  // The core barrel is loaded HERE, inside the command (mmnto-ai/totem#2339).
  const { isBotReviewerLogin, isBotReviewerLoginExact } = await import('@mmnto/totem');
  const identity: BotIdentityPredicates = {
    isBotLoginExact: isBotReviewerLoginExact,
    isBotLoginLoose: isBotReviewerLogin,
  };
  const runner = opts.runner ?? (await defaultRunner(opts.cwd ?? process.cwd()));

  const repoRun = runner(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (repoRun.exitCode !== 0) {
    fail(
      `could not resolve the repository from gh (exit ${repoRun.exitCode}: ${bounded(repoRun.stdout)}) — nothing was resolved. Run \`gh auth status\` inside the repo.`,
      1,
    );
    return { exitCode: 1, rows: [] };
  }
  const nwo = repoRun.stdout.trim();
  const [owner, name] = nwo.split('/');
  if (owner === undefined || name === undefined || owner === '' || name === '') {
    fail(`gh answered "${bounded(nwo)}" for the repository, which is not owner/name`, 1);
    return { exitCode: 1, rows: [] };
  }

  const threadsRead = readReviewThreads(runner, owner, name, pr);
  if (!threadsRead.ok) {
    fail(`review threads NOT read — nothing resolved. ${threadsRead.detail}`, 1);
    return { exitCode: 1, rows: [] };
  }

  const commentsRead = readPrIssueComments(runner, owner, name, pr);
  if (!commentsRead.ok) {
    fail(
      `PR-level comments NOT read — evidence cannot be derived, so nothing resolved. ${commentsRead.detail}`,
      1,
    );
    return { exitCode: 1, rows: [] };
  }

  const records = toThreadRecords(threadsRead.threads, identity);
  const prComments = toPrCommentRecords(commentsRead.comments, identity);
  const plan = buildResolveThreadsPlan(records, prComments, identity, selection.ids);

  if (plan.unmatchedIds.length > 0) {
    fail(
      `--ids named ${plan.unmatchedIds.length} id(s) matching no bot-rooted thread on PR #${pr}: ${plan.unmatchedIds.join(', ')} — nothing was resolved`,
      2,
      plan.rows,
    );
    return { exitCode: 2, rows: plan.rows };
  }

  const mode = apply ? 'apply' : 'dry-run';
  emit(`resolve-threads ${nwo}#${pr} (${mode})`);
  emit(
    `${plan.rows.length} bot-rooted thread(s) of ${records.length} review thread(s); ${prComments.length} PR-level comment(s) read`,
  );

  if (plan.rows.length === 0) {
    emit('nothing to resolve');
    if (json) out(`${JSON.stringify(jsonDocument(nwo, pr, apply, plan.rows, 0), null, 2)}\n`);
    return { exitCode: 0, rows: plan.rows };
  }

  for (const row of plan.rows) {
    emit(formatRow(row));
    if (row.verdict === 'skip:no-evidence') emit(`  ${NO_EVIDENCE_HINT}`);
  }

  let failures = 0;
  if (apply) {
    const targets = plan.rows.filter((r) => r.verdict === 'resolve');
    emit(`applying resolveReviewThread to ${targets.length} thread(s)`);
    for (const row of targets) {
      const run = runJson(
        runner,
        graphqlArgs(RESOLVE_THREAD_MUTATION, [['threadId', row.threadId]]),
        `resolveReviewThread ${row.threadId}`,
      );
      // A clean exit is not the same as a resolved thread: the mutation's own
      // answer must say so. Anything else — a null payload, a thread that came
      // back `isResolved: false`, a shape that does not parse — is a per-thread
      // FAILURE, never a silent "applied".
      const confirmed = run.ok ? confirmResolved(run.body) : { ok: false, detail: run.detail };
      if (confirmed.ok) {
        row.applied = true;
        emit(`applied  id=${row.rootCommentId ?? 'unknown'}  ${row.threadId}`);
      } else {
        // A per-thread failure never aborts the run — the remaining threads are
        // still resolved and the count is named in the exit code.
        row.applied = false;
        row.errorText = confirmed.detail;
        failures += 1;
        err(`[Totem Error] failed to resolve ${row.threadId}: ${confirmed.detail}\n`);
        emit(`failed   id=${row.rootCommentId ?? 'unknown'}  ${row.threadId}`);
      }
    }
  }

  const counts = countVerdicts(plan.rows);
  emit(
    `plan: ${counts.resolve} resolve, ${counts['skip:already-resolved']} already-resolved, ${counts['skip:outdated']} outdated, ${counts['skip:no-evidence']} no-evidence, ${counts['skip:not-selected']} not-selected`,
  );
  if (apply) {
    emit(`applied ${counts.resolve - failures} of ${counts.resolve}; ${failures} failed`);
  } else {
    emit("dry-run — nothing was mutated; re-run with --apply on the operator's explicit go");
  }

  let exitCode: 0 | 1 | 2 = 0;
  if (failures > 0) {
    err(
      `[Totem Error] ${failures} thread(s) failed to resolve — re-run (the mutation is idempotent)\n`,
    );
    exitCode = 2;
  }
  if (apply && counts['skip:no-evidence'] > 0) {
    err(
      `[Totem Error] ${counts['skip:no-evidence']} selected thread(s) had no disposition evidence and were NOT resolved — ${NO_EVIDENCE_HINT}\n`,
    );
    exitCode = 2;
  }

  if (json) out(`${JSON.stringify(jsonDocument(nwo, pr, apply, plan.rows, failures), null, 2)}\n`);
  return { exitCode, rows: plan.rows };
}

/** Verdict tally over the plan rows. */
function countVerdicts(rows: readonly ResolveThreadsRow[]): Record<ResolveThreadsVerdict, number> {
  const counts: Record<ResolveThreadsVerdict, number> = {
    resolve: 0,
    'skip:already-resolved': 0,
    'skip:outdated': 0,
    'skip:no-evidence': 0,
    'skip:not-selected': 0,
  };
  for (const row of rows) counts[row.verdict] += 1;
  return counts;
}

/** The `--json` document: the SAME rows the human lines carry, plus the tally. */
function jsonDocument(
  repo: string,
  pr: number,
  apply: boolean,
  rows: readonly ResolveThreadsRow[],
  failures: number,
): Record<string, unknown> {
  const counts = countVerdicts(rows);
  return {
    repo,
    pr,
    apply,
    rows,
    summary: {
      botRooted: rows.length,
      ...counts,
      applied: apply ? counts.resolve - failures : 0,
      failed: failures,
    },
  };
}
