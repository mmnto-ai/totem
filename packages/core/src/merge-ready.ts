import { hasBotAppLoginSuffix, isBotReviewerLoginExact } from './bot-identity.js';
import { TotemError } from './errors.js';
import type { GateEvaluator, GateTier, GateVerdict, GhRunner } from './gate-types.js';
import { safeExec } from './sys/exec.js';

/**
 * merge-ready (mmnto-ai/totem#2800): a PreToolUse gate over the Bash and
 * PowerShell tools that reads the five-point deterministic pre-merge floor off
 * GitHub before `gh pr merge` runs.
 *
 * ZERO LLM calls, zero filesystem writes. The only outside state is what `gh`
 * answers, and `gh` reaches this module through the injected {@link GhRunner}
 * seam so a test replaces the network with a checked-in capture (R3, R4).
 *
 * The five predicates, evaluated IN ORDER (the first failure is the reason):
 *   1. `checks`                — the head commit's status-check rollup is green
 *   2. `unresolved-bot-threads`— no unresolved, non-outdated review thread whose
 *                                ROOT comment is one of the known review bots
 *   3. `changes-requested`     — no un-superseded CHANGES_REQUESTED review
 *   4. `high-severity-inline`  — no HIGH/Major bot inline that CURRENTLY applies
 *                                to the head commit (`comment.commit.oid`) and
 *                                is not DISCHARGED through the disposition path
 *                                (mmnto-ai/totem#2861): its thread RESOLVED plus
 *                                a disposition NAMING IT — a non-bot reply
 *                                after the root inside the thread, or a
 *                                non-bot PR-level comment created after the
 *                                root carrying a `disposition: <root comment
 *                                id> <verb>` line for this thread. A bare
 *                                resolve, or a round disposition that did not
 *                                name the thread, still applies at every tier
 *                                (fail-closed)
 *   5. `merge-state`           — GitHub's own `mergeStateStatus` is mergeable
 *
 * THE TIER SPLIT (R1): a predicate that FAILS is `deny` at every tier (the
 * wrapper's tier map decides whether that blocks). A predicate whose INPUT
 * could not be derived — gh missing, an API error, an incomplete page, a head
 * that moved mid-read, `mergeStateStatus: UNKNOWN` — is the UNEVALUABLE class:
 * `deny` under strict, `warn` under pilot, and NEVER `allow`. Every unevaluable
 * path is named on stderr under BOTH tiers; only the exit code differs.
 *
 * THE OVERRIDE: `TOTEM_MERGE_GATE_OVERRIDE=1` yields `allow` plus one stderr
 * audit line naming the repo, the PR, the head sha and the predicates that
 * would have denied. It is read per evaluation (no module-level state).
 */

/** The gate's registry event name. */
export const MERGE_READY_EVENT = 'merge-ready';

/** The module label every verdict cites as its `provenance.source` (never a path). */
export const MERGE_READY_SOURCE = 'merge-ready gh graphql read';

/** The audited bypass. Set to exactly `1`; any other value is not an override. */
export const MERGE_READY_OVERRIDE_ENV = 'TOTEM_MERGE_GATE_OVERRIDE';

/** Prefix every stderr line this gate emits carries, so a reader can grep one gate out of a hook log. */
export const MERGE_READY_NOTICE_PREFIX = '[totem merge-ready]';

/** Page size for every paginated connection in the query. */
const PAGE_SIZE = 100;

/**
 * Hard cap on GraphQL round trips per evaluation. A PR that needs more pages
 * than this is UNEVALUABLE (named), never "clean by exhaustion" — the capped-read
 * bar from the charter's errata item 5.
 */
const MAX_PAGES = 20;

/** `provenance.matched` (and every quoted evidence fragment) is bounded to this many characters. */
export const MERGE_READY_EVIDENCE_MAX = 160;

/** The predicates, in evaluation order. */
export type MergeReadyPredicate =
  | 'checks'
  | 'unresolved-bot-threads'
  | 'changes-requested'
  | 'high-severity-inline'
  | 'merge-state';

/** The payload the wrapper projects from a `gh pr merge` command (or a hand caller passes). */
export interface MergeReadyPayload {
  /** `owner/name`. */
  repo: string;
  /** The PR number, or null when the command named no PR (then `branch` carries the target). */
  pr: number | null;
  /** The branch the PR is resolved from when `pr` is null. */
  branch?: string;
  /** The local head sha the caller believes it is merging, when it could read one. */
  headSha?: string;
  /**
   * A `gh pr merge` argument the projection could not turn into a PR — an
   * UNEXPANDED shell variable (`gh pr merge $PR`), whose value the wrapper
   * cannot know (mmnto-ai/totem#2800 fold F13). Carried instead of guessed: a
   * literal `"$PR"` read as a branch name would resolve nothing and the gate
   * would judge the wrong PR, or none. Present ⇒ the evaluation is UNEVALUABLE
   * before any read, so strict denies and pilot warns (R1).
   */
  unresolvedTarget?: string;
}

/**
 * The rich evidence every merge-ready verdict carries in `provenance.detail`.
 * A type alias, not an interface, so it satisfies the verdict's
 * `Record<string, unknown>` detail slot without a cast.
 */
export type MergeReadyProvenanceDetail = {
  repo: string;
  pr: number | null;
  /** The PR head sha as GitHub answered it, or null when the read never got that far. */
  headSha: string | null;
  /**
   * Predicate 1's count, per check NAME after the latest-run judgment
   * (mmnto-ai/totem#2879): `total` counts names, the way `gh pr checks` and
   * the merge box do; `superseded` counts the check runs a later run of the
   * same name replaced (a concurrency group's cancelled duplicates), which
   * are read and disclosed but never judged.
   */
  checks: { total: number; success: number; pending: number; failing: number; superseded: number };
  threads: { unresolvedBot: number; pagesRead: number; complete: boolean };
  changesRequestedBy: string[];
  /** HIGH/Major bot inlines on the head commit that still APPLY after the discharge read — predicate 4's count. */
  highInline: number;
  /**
   * HIGH/Major bot inlines on the head commit DISCHARGED through the
   * disposition path (mmnto-ai/totem#2861): thread resolved, and a
   * disposition on record after the root. Carried so the audit record shows
   * what the predicate released, not only what it kept.
   */
  dischargedHigh: number;
  /** The discharges split by the arm that carried each: an in-thread non-bot reply, or a PR-level disposition line naming the thread. */
  dischargedBy: { inThreadReply: number; prLevelDisposition: number };
  mergeStateStatus: string | null;
  evaluatedAt: string;
  /** `gh <version>`, read from the same binary that answered the query. */
  evaluatedBy: string;
  /** Present and true only when the audited override produced the verdict. */
  override?: boolean;
};

/** What one evaluation produced: the verdict, its evidence, and the lines the host must print. */
export interface MergeReadyEvaluation {
  verdict: GateVerdict;
  detail: MergeReadyProvenanceDetail;
  /** stderr lines, already prefixed. Every unevaluable path and R5's zero-check fact is here. */
  notices: readonly string[];
}

/** Options for the pure {@link evaluateMergeReady} entry point. */
export interface MergeReadyOptions {
  /** The gh seam. Production passes {@link makeGhRunner}; tests pass fixtures. */
  runner: GhRunner;
  /** Enforcement tier for the UNEVALUABLE class only (default `strict`). */
  tier?: GateTier;
  /** Environment the override is read from (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Clock seam for `checkedAt` / `evaluatedAt` (default `Date`). */
  now?: () => Date;
}

// ─── The read surface (R2: one GraphQL query, explicit cursors, no REST) ────

/**
 * The PR fields every predicate reads, as a fragment so the number-keyed and
 * branch-keyed documents cannot drift apart. The four paginated connections
 * each take their own cursor variable, declared by the operation.
 *
 * `comments(first: 10)` on a thread is deliberate: only the ROOT comment is
 * judged (it is the finding; the rest are the discussion), matching how triage
 * reads a thread. The later comments are read for EVIDENCE only — a non-bot
 * reply after the root discharges a resolved HIGH (mmnto-ai/totem#2861) — and
 * the window's `pageInfo` is selected too, so a thread with more replies than
 * the window is judged on what was read and SAYS so in the reason, never read
 * as "no reply" silently. The root is `comments.nodes[0]`: the one capture in
 * `gate-fixtures/merge-ready/` with a multi-comment thread (liquid-city-363)
 * answers root first, then the reply, and `resolve-threads` reads the same
 * position — a positional assumption shared by both consumers and resting on
 * that one observation, not a transcribed schema guarantee, which is why the
 * reply test below is ALSO temporal (a reply counts only when its `createdAt`
 * follows the root's; across sixteen live PRs no reply preceded its root). The
 * root's `databaseId` is its REST comment id — the `id=` a `totem
 * resolve-threads` dry-run row prints (`totem triage-pr` carries it internally
 * and prints none: the third leg's r3-f2), and the id a PR-level disposition
 * line names.
 * The PR-level `comments` connection is the other evidence surface: a non-bot
 * comment created after a thread's root whose BODY carries a
 * `disposition: <root comment id> <verb>` line for THAT thread (the review-reply
 * skill's step 2 emits one per bot thread the round answered) — paginated in
 * full like the rest, bodies included. `author { __typename }` is selected on
 * both because it is the one signal that names EVERY GitHub App a bot (the
 * resolve-threads rule): without it an App's reply would read as the human
 * answer.
 */
const MERGE_READY_FRAGMENT = `fragment MergeReadyPr on PullRequest {
  number
  isDraft
  mergeStateStatus
  headRefOid
  headRefName
  baseRefName
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: ${PAGE_SIZE}, after: $checksAfter) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on CheckRun { name status conclusion databaseId }
              ... on StatusContext { context state }
            }
          }
        }
      }
    }
  }
  reviews(first: ${PAGE_SIZE}, after: $reviewsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      author { login }
      state
      submittedAt
    }
  }
  reviewThreads(first: ${PAGE_SIZE}, after: $threadsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      isResolved
      isOutdated
      comments(first: 10) {
        pageInfo { hasNextPage }
        nodes {
          databaseId
          author { __typename login }
          body
          createdAt
          commit { oid }
          originalCommit { oid }
        }
      }
    }
  }
  comments(first: ${PAGE_SIZE}, after: $commentsAfter) {
    pageInfo { hasNextPage endCursor }
    nodes {
      author { __typename login }
      body
      createdAt
    }
  }
}`;

const SHARED_VARS =
  '$owner: String!, $name: String!, $reviewsAfter: String, $threadsAfter: String, $checksAfter: String, $commentsAfter: String';

/** The read the evaluator sends when the payload names a PR number. Fixtures are captured with THIS string. */
export const MERGE_READY_QUERY = `query TotemMergeReady($number: Int!, ${SHARED_VARS}) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { ...MergeReadyPr }
  }
}

${MERGE_READY_FRAGMENT}`;

/**
 * The read the evaluator sends when the payload carries a branch and no number
 * (`gh pr merge` with no argument). Same fragment, so the predicates read the
 * same fields; the first page resolves the number, and every later page uses
 * {@link MERGE_READY_QUERY} against that fixed number.
 */
export const MERGE_READY_BRANCH_QUERY = `query TotemMergeReadyByBranch($branch: String!, ${SHARED_VARS}) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 1, states: OPEN, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { ...MergeReadyPr }
    }
  }
}

${MERGE_READY_FRAGMENT}`;

// ─── Payload parsing (fail loud — the engine never default-allows) ──────────

const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SHA_40 = /^[0-9a-f]{40}$/i;

/** Parse + validate the payload. Throws `GATE_INVALID` (the wrapper's fail-closed arm) on anything else. */
export function parseMergeReadyPayload(payload: unknown): MergeReadyPayload {
  const invalid = (why: string): never => {
    throw new TotemError(
      'GATE_INVALID',
      `merge-ready payload is invalid: ${why}.`,
      'Pass --payload \'{"repo":"owner/name","pr":123}\' (or "pr":null with "branch":"<name>").',
    );
  };

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalid('expected a JSON object');
  }
  const raw = payload as Record<string, unknown>;

  const repo = typeof raw.repo === 'string' ? raw.repo.trim() : '';
  if (repo === '') return invalid('"repo" must be a non-empty "owner/name" string');
  if (!REPO_SLUG.test(repo)) return invalid(`"repo" must look like owner/name (got "${repo}")`);

  let pr: number | null = null;
  if (typeof raw.pr === 'number') {
    if (!Number.isInteger(raw.pr) || raw.pr <= 0) return invalid('"pr" must be a positive integer');
    pr = raw.pr;
  } else if (raw.pr !== null && raw.pr !== undefined) {
    return invalid('"pr" must be a positive integer or null');
  }

  let branch: string | undefined;
  if (typeof raw.branch === 'string' && raw.branch.trim() !== '') {
    branch = raw.branch.trim();
  } else if (raw.branch !== undefined && typeof raw.branch !== 'string') {
    return invalid('"branch" must be a string when present');
  }

  let unresolvedTarget: string | undefined;
  if (typeof raw.unresolvedTarget === 'string' && raw.unresolvedTarget.trim() !== '') {
    unresolvedTarget = raw.unresolvedTarget.trim();
  } else if (raw.unresolvedTarget !== undefined && typeof raw.unresolvedTarget !== 'string') {
    return invalid('"unresolvedTarget" must be a string when present');
  }

  if (pr === null && branch === undefined && unresolvedTarget === undefined) {
    return invalid('either "pr" or "branch" must identify the pull request');
  }

  let headSha: string | undefined;
  if (typeof raw.headSha === 'string' && raw.headSha.trim() !== '') {
    const trimmed = raw.headSha.trim();
    if (!SHA_40.test(trimmed)) return invalid('"headSha" must be a 40-character hex sha');
    headSha = trimmed.toLowerCase();
  } else if (raw.headSha !== undefined && typeof raw.headSha !== 'string') {
    return invalid('"headSha" must be a string when present');
  }

  return {
    repo,
    pr,
    ...(branch === undefined ? {} : { branch }),
    ...(headSha === undefined ? {} : { headSha }),
    ...(unresolvedTarget === undefined ? {} : { unresolvedTarget }),
  };
}

// ─── Narrow readers over the GraphQL body (no `any`, no silent coercion) ────

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A non-negative integer as the API typed it; anything else is null, never coerced. */
function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** One classified status check. */
interface CheckEntry {
  name: string;
  kind: 'success' | 'pending' | 'failing';
  /** Which rollup node type answered it: a CheckRun (Actions, apps) or a legacy StatusContext. */
  typename: 'CheckRun' | 'StatusContext';
  /**
   * The CheckRun's `databaseId` — GitHub's check-run id, a single increasing
   * sequence, so among same-named runs on one head the greatest id IS the
   * latest run (mmnto-ai/totem#2879). Null on a StatusContext, and on a
   * CheckRun whose id did not read as a non-negative integer.
   */
  runId: number | null;
}

/** One review, reduced to what predicate 3 reads. */
interface ReviewEntry {
  login: string;
  state: string;
  submittedAt: string | null;
}

/** One review thread, reduced to what predicates 2 and 4 read. */
interface ThreadEntry {
  isResolved: boolean;
  isOutdated: boolean;
  rootLogin: string | null;
  rootBody: string;
  /**
   * The root comment's REST id (`databaseId`) — what a PR-level `disposition:`
   * line names (mmnto-ai/totem#2861). Null when the answer carried none: the
   * schema types the field nullable, so a root without one is a THREAD no
   * line can name (fail-closed for that thread), never an unreadable page —
   * a page-scoped refusal would route a PR into the unevaluable class, which
   * pilot maps to `warn` (the third leg's r3-f4).
   */
  rootId: number | null;
  /** The root comment's `createdAt` — the instant a PR-level disposition must post AFTER (mmnto-ai/totem#2861). */
  rootCreatedAt: string;
  /**
   * Non-bot comments inside the read window whose `createdAt` follows the
   * root's — the resolve-threads in-thread-reply arm, with a temporal test
   * beside the positional one (see the fragment docstring). A deleted account
   * (null author) counts: the reply was human when it was written.
   */
  humanReplies: number;
  /** False when the thread carries more comments than the window read (`comments.pageInfo.hasNextPage`). */
  commentsComplete: boolean;
  /**
   * `comment.commit.oid` — the commit the comment CURRENTLY applies to, which
   * GitHub re-points as the diff moves. This is what predicate 4 reads (the
   * prototype's (c) semantics), and the REST `commit_id` the charter names.
   */
  rootCommit: string | null;
  /**
   * `comment.originalCommit.oid` — the commit it was WRITTEN against. Carried
   * for provenance only: it never moves, so a predicate keyed on it goes inert
   * the moment the branch advances.
   */
  rootOriginalCommit: string | null;
}

/** One PR-level (issue) comment, reduced to what the discharge reads (mmnto-ai/totem#2861). */
interface PrCommentEntry {
  isBot: boolean;
  createdAt: string;
  /** The root comment ids the body names on `disposition:` lines ({@link dispositionedRootIds}). */
  dispositions: readonly number[];
}

/**
 * The per-thread disposition line (mmnto-ai/totem#2861, the operator's ruling
 * of 2026-09-16 on the linkage fork): the review-reply skill's step 2 ends a
 * round disposition with ONE machine line per bot-rooted thread the round
 * answered —
 *
 *     disposition: <root comment id> <verb>
 *
 * — the id being the thread root's REST comment id (`databaseId`; the `id=`
 * on a `totem resolve-threads` dry-run row, the one command that prints it —
 * `totem triage-pr` carries it internally and prints none) and the verb the
 * round's word for it (fixed, declined, deferred,
 * nit, extracted, held). Predicate 4 reads the ID: a PR-level comment names
 * a thread when a line carries that thread's root id — and a round
 * disposition that answered OTHER threads does not name this one. That last
 * case is why the line exists: two earlier reads keyed the arm to the ROUND
 * (post-dating alone, then post-dating plus the round's `local-lane:` line),
 * and both let a bare resolve of a HIGH the round never addressed discharge —
 * the two falsification legs' blocking findings, executed on the built core.
 * Naming the thread is what the ruling asked for, and an id is exact where a
 * marker was a shape. By construction no other surface writes a line of this
 * shape: a trigger comment, a gate-read note or a merge note carries no id at
 * line start, and the gate's own deny reason quotes the line inside double
 * quotes mid-sentence (the third leg tried the reason verbatim, fenced,
 * unquoted, and a pasted resolve-threads row, and none read as a line) — an
 * inference about bodies, made safe by the id rather than proven.
 *
 * Read against the raw body with HTML comments removed (a terminated
 * `<!-- … -->`, and an unterminated `<!--` to the end of the body, the way a
 * renderer hides it), at line start with leading blanks allowed, anywhere in
 * the body — fenced included, because the skills render machine lines in text
 * fences. A blockquoted, listed or tabled line, or one inside an inline span,
 * is not at line start and does not count. The id is the decimal the seat
 * copied: no leading zero, no sign, no fraction, nothing glued to it — the
 * third leg's r3-f5 showed `Number()` equating `01001`, `1001.5` and `1001x`
 * to 1001, so the token is matched exactly and never coerced. The verb is not
 * validated here: the gate answers "was this thread dispositioned", not
 * "how".
 */
const DISPOSITION_LINE = /^[ \t]*disposition:[ \t]+([1-9]\d*)(?=[ \t]|\r?$)/gm;

/**
 * The root comment ids a PR-level comment body names on disposition lines,
 * in first-seen order, without duplicates. Exported for the tests, so they
 * assert the shipped predicate and not a copy of it.
 */
export function dispositionedRootIds(body: string): number[] {
  const ids: number[] = [];
  const stripped = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<!--[\s\S]*$/, '');
  for (const match of stripped.matchAll(DISPOSITION_LINE)) {
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** One page of the read, already classified. */
interface PrPage {
  number: number;
  headRefOid: string;
  mergeStateStatus: string;
  isDraft: boolean;
  /** false when the head commit carries no rollup at all (a PR with zero checks). */
  rollupPresent: boolean;
  /** The rollup state GitHub reported, or null when there is no rollup. */
  rollupState: string | null;
  /** `contexts.totalCount` EXACTLY as reported — judged by the caller, not coerced. */
  rollupTotalCount: unknown;
  checks: CheckEntry[];
  checksHasNext: boolean;
  checksCursor: string | null;
  reviews: ReviewEntry[];
  reviewsHasNext: boolean;
  reviewsCursor: string | null;
  threads: ThreadEntry[];
  threadsHasNext: boolean;
  threadsCursor: string | null;
  prComments: PrCommentEntry[];
  commentsHasNext: boolean;
  commentsCursor: string | null;
}

type PageRead = { ok: true; page: PrPage } | { ok: false; detail: string };

/**
 * A CheckRun's conclusion vocabulary. `NEUTRAL` and `SKIPPED` are successes (a
 * skipped required check is branch protection's business, not this gate's);
 * every other terminal conclusion — including an absent one on a COMPLETED run
 * — is a failure, because an unreadable outcome must never read as green.
 */
const SUCCESS_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const SUCCESS_CONTEXT_STATES = new Set(['SUCCESS']);
/**
 * The name a CheckRun gets when GitHub's answer carried none. `CheckRun.name`
 * is NON_NULL in the schema, so this is reachable only from a malformed or
 * mocked payload — and two such nodes must never be read as one check ran
 * twice (leg F10 on mmnto-ai/totem#2879): the latest-run collapse skips it.
 */
const UNNAMED_CHECK = '(unnamed check)';
const PENDING_CONTEXT_STATES = new Set(['PENDING', 'EXPECTED']);

/**
 * A connection's `pageInfo`, read STRICTLY: the query asks for it on every
 * connection, so an answer without one — or with a `hasNextPage` that is not
 * a boolean — is an unreadable page, never "no more pages". Reading a missing
 * `pageInfo` as complete was the fail-open Greptile named on the reviews and
 * threads connections (mmnto-ai/totem#2844 round 1): a truncated or malformed
 * answer read as a clean, finished list and predicates 2–4 passed on it.
 */
function readPageInfo(
  connection: Record<string, unknown> | null,
): { ok: true; hasNext: boolean; cursor: string | null } | { ok: false; detail: string } {
  const info = asObject(connection?.pageInfo);
  if (info === null) return { ok: false, detail: 'carried no pageInfo' };
  if (typeof info.hasNextPage !== 'boolean') {
    return { ok: false, detail: 'carried a pageInfo whose hasNextPage is not a boolean' };
  }
  return { ok: true, hasNext: info.hasNextPage, cursor: asString(info.endCursor) };
}

function readChecks(rollup: Record<string, unknown> | null): {
  entries: CheckEntry[];
  hasNext: boolean;
  cursor: string | null;
  detail?: string;
} {
  const contexts = asObject(rollup?.contexts);
  const entries: CheckEntry[] = [];
  // No rollup at all is the R5 no-checks shape (the caller has already
  // refused a rollup WITHOUT a contexts connection): an empty, complete list.
  if (contexts === null) return { entries, hasNext: false, cursor: null };
  const nodes = asArray(contexts.nodes);
  if (nodes === null) {
    return {
      entries,
      hasNext: false,
      cursor: null,
      detail: 'the status-check rollup contexts carried no nodes array',
    };
  }
  for (const node of nodes) {
    const n = asObject(node);
    if (n === null)
      return { entries, hasNext: false, cursor: null, detail: 'a check node was not an object' };
    const typename = asString(n.__typename);
    if (typename === 'CheckRun') {
      const name = asString(n.name) ?? UNNAMED_CHECK;
      const status = asString(n.status) ?? '';
      const conclusion = asString(n.conclusion);
      const runId = asNonNegativeInteger(n.databaseId);
      if (status !== 'COMPLETED') {
        entries.push({ name, kind: 'pending', typename, runId });
      } else if (conclusion !== null && SUCCESS_CONCLUSIONS.has(conclusion)) {
        entries.push({ name, kind: 'success', typename, runId });
      } else {
        entries.push({ name, kind: 'failing', typename, runId });
      }
    } else if (typename === 'StatusContext') {
      const name = asString(n.context) ?? '(unnamed context)';
      const state = asString(n.state) ?? '';
      if (SUCCESS_CONTEXT_STATES.has(state)) {
        entries.push({ name, kind: 'success', typename, runId: null });
      } else if (PENDING_CONTEXT_STATES.has(state)) {
        entries.push({ name, kind: 'pending', typename, runId: null });
      } else {
        entries.push({ name, kind: 'failing', typename, runId: null });
      }
    } else {
      return {
        entries,
        hasNext: false,
        cursor: null,
        detail: `a check node carried an unknown __typename "${typename ?? 'null'}"`,
      };
    }
  }
  const info = readPageInfo(contexts);
  if (!info.ok) {
    return {
      entries,
      hasNext: false,
      cursor: null,
      detail: `the status-check rollup contexts ${info.detail}`,
    };
  }
  return { entries, hasNext: info.hasNext, cursor: info.cursor };
}

/**
 * The `reviews` connection, read as STRICTLY as the checks connection above
 * (mmnto-ai/totem#2844 round 1, Greptile): a connection that is missing, has no
 * `nodes` array, has no readable `pageInfo`, or carries a node that is not an
 * object or has no `state` is an UNREADABLE answer, returned with a named
 * `detail` — never an empty, complete list that lets predicate 3 pass on an
 * answer the read did not actually receive. A review whose author is a
 * deleted account (`author: null`) is the one shape SKIPPED rather than
 * refused: it carries no identity to supersede or attribute, so it is never
 * counted as a CHANGES_REQUESTED nobody can clear.
 */
function readReviews(connection: Record<string, unknown> | null): {
  entries: ReviewEntry[];
  hasNext: boolean;
  cursor: string | null;
  detail?: string;
} {
  const entries: ReviewEntry[] = [];
  const unreadable = (why: string): ReturnType<typeof readReviews> => ({
    entries,
    hasNext: false,
    cursor: null,
    detail: `the reviews connection ${why}`,
  });
  if (connection === null) return unreadable('was missing from the answer');
  const nodes = asArray(connection.nodes);
  if (nodes === null) return unreadable('carried no nodes array');
  for (const node of nodes) {
    const n = asObject(node);
    if (n === null) return unreadable('carried a node that is not an object');
    const state = asString(n.state);
    if (state === null) return unreadable('carried a review with no state');
    const login = asString(asObject(n.author)?.login);
    if (login === null) continue;
    entries.push({ login, state, submittedAt: asString(n.submittedAt) });
  }
  const info = readPageInfo(connection);
  if (!info.ok) return unreadable(info.detail);
  return { entries, hasNext: info.hasNext, cursor: info.cursor };
}

/**
 * A comment's author, read STRICTLY for the evidence rule (mmnto-ai/totem#2861).
 * `null` is a deleted account — NOT a bot: the reply was human when it was
 * written, and deleting the account does not retract it (the resolve-threads
 * rule, item 6 of `.totem/specs/2841.md`). Otherwise `__typename` and `login`
 * must both be strings. `__typename` is REQUIRED, not optional, because it is
 * the only signal that names EVERY GitHub App a bot (`github-actions`, a
 * Copilot reviewer, a scanner): a document that quietly stopped selecting it
 * would fail OPEN, every App reply reading as the human answer — the same
 * guard resolve-threads holds at its zod boundary. The three bot arms are the
 * verb's: GitHub's own `Bot` typename, the `[bot]` App suffix, or core's exact
 * review-bot list.
 */
function readAuthor(
  value: unknown,
): { ok: true; login: string | null; isBot: boolean } | { ok: false; detail: string } {
  if (value === null) return { ok: true, login: null, isBot: false };
  const author = asObject(value);
  if (author === null) return { ok: false, detail: 'author is neither null nor an object' };
  const typename = asString(author.__typename);
  const login = asString(author.login);
  if (typename === null || login === null) {
    return { ok: false, detail: 'author has no __typename or no login' };
  }
  // On every capture the `Bot` typename is the arm that decides for a review
  // bot (their GraphQL logins carry no suffix); the two login arms are the
  // verb's belt-and-braces, kept so the two consumers of the rule agree. The
  // null-author rule applies on BOTH surfaces: a deleted account's PR-level
  // comment carrying a disposition line discharges the thread it names — not
  // guarded, judged unreachable (a removed App's summary would have to carry
  // this thread's root id at line start; the third leg's r3-f11).
  return {
    ok: true,
    login,
    isBot: typename === 'Bot' || hasBotAppLoginSuffix(login) || isBotReviewerLoginExact(login),
  };
}

/**
 * The `reviewThreads` connection, read with the same strictness as
 * {@link readReviews}: a missing connection, a missing `nodes` array or
 * `pageInfo`, a thread node that is not an object, or a thread whose first
 * comment cannot be read (no `comments.nodes` array, or an empty one — a
 * review thread always has its root comment) is UNREADABLE and named, so
 * predicates 2 and 4 never pass on a list the read did not deliver
 * (mmnto-ai/totem#2844 round 1). A root comment whose author is a deleted
 * account keeps `rootLogin: null` — it is not a known bot, which is a fact
 * about the thread, not an unreadable answer.
 *
 * The evidence fields (mmnto-ai/totem#2861) are held to the same bar: the
 * comments window's own `pageInfo`, the root's `createdAt`, and every
 * author's `__typename` — a thread missing any of them is unreadable, never
 * "complete with no reply", because that is the shape a discharge would fail
 * open on. The root's `databaseId` is the one field read the other way: the
 * schema types it nullable, and a root without one cannot be named by any
 * line, so that THREAD stays applying (fail-closed) while the page stays
 * readable — refusing the page would send a PR into the unevaluable class and
 * pilot's `warn` (r3-f4).
 */
function readThreads(connection: Record<string, unknown> | null): {
  entries: ThreadEntry[];
  hasNext: boolean;
  cursor: string | null;
  detail?: string;
} {
  const entries: ThreadEntry[] = [];
  const unreadable = (why: string): ReturnType<typeof readThreads> => ({
    entries,
    hasNext: false,
    cursor: null,
    detail: `the review threads connection ${why}`,
  });
  if (connection === null) return unreadable('was missing from the answer');
  const nodes = asArray(connection.nodes);
  if (nodes === null) return unreadable('carried no nodes array');
  for (const node of nodes) {
    const n = asObject(node);
    if (n === null) return unreadable('carried a node that is not an object');
    const commentsConnection = asObject(n.comments);
    const comments = asArray(commentsConnection?.nodes);
    if (comments === null) return unreadable('carried a thread with no comments array');
    const root = asObject(comments[0]);
    if (root === null) return unreadable('carried a thread whose root comment is unreadable');
    const window = readPageInfo(commentsConnection);
    if (!window.ok) {
      return unreadable(`carried a thread whose comments connection ${window.detail}`);
    }
    const rootAuthor = readAuthor(root.author);
    if (!rootAuthor.ok) return unreadable(`carried a thread whose root ${rootAuthor.detail}`);
    const rootCreatedAt = asString(root.createdAt);
    if (rootCreatedAt === null) {
      return unreadable('carried a thread whose root comment has no createdAt');
    }
    // The root's REST id is what a disposition line names; a root without a
    // safe-integer one cannot be matched to any line and its thread stays
    // applying — thread-scoped, never a page refusal (mmnto-ai/totem#2861).
    const rootId =
      typeof root.databaseId === 'number' && Number.isSafeInteger(root.databaseId)
        ? root.databaseId
        : null;
    const rootAt = Date.parse(rootCreatedAt);
    let humanReplies = 0;
    for (const reply of comments.slice(1)) {
      const r = asObject(reply);
      if (r === null) return unreadable('carried a thread with a reply that is not an object');
      const author = readAuthor(r.author);
      if (!author.ok) return unreadable(`carried a thread with a reply whose ${author.detail}`);
      const replyCreatedAt = asString(r.createdAt);
      if (replyCreatedAt === null)
        return unreadable('carried a thread with a reply that has no createdAt');
      // Positional AND temporal: a non-bot comment after the root in the list
      // that also post-dates it. An unparseable instant on either side is not
      // a reply that counts — the conservative direction.
      const replyAt = Date.parse(replyCreatedAt);
      if (!author.isBot && !Number.isNaN(rootAt) && !Number.isNaN(replyAt) && replyAt > rootAt) {
        humanReplies++;
      }
    }
    entries.push({
      isResolved: n.isResolved === true,
      isOutdated: n.isOutdated === true,
      rootLogin: rootAuthor.login,
      rootBody: asString(root.body) ?? '',
      rootId,
      rootCreatedAt,
      humanReplies,
      commentsComplete: !window.hasNext,
      rootCommit: asString(asObject(root.commit)?.oid),
      rootOriginalCommit: asString(asObject(root.originalCommit)?.oid),
    });
  }
  const info = readPageInfo(connection);
  if (!info.ok) return unreadable(info.detail);
  return { entries, hasNext: info.hasNext, cursor: info.cursor };
}

/**
 * The PR-level `comments` connection — the second evidence surface
 * (mmnto-ai/totem#2861), read as strictly as the others: a missing connection,
 * a missing `nodes` array or `pageInfo`, a node that is not an object, an
 * author without `__typename` / `login`, or a comment without a string `body`
 * or `createdAt` is an UNREADABLE page, named — never "no evidence", which
 * would deny a dispositioned HIGH for a reason that misnames its cause.
 */
function readPrComments(connection: Record<string, unknown> | null): {
  entries: PrCommentEntry[];
  hasNext: boolean;
  cursor: string | null;
  detail?: string;
} {
  const entries: PrCommentEntry[] = [];
  const unreadable = (why: string): ReturnType<typeof readPrComments> => ({
    entries,
    hasNext: false,
    cursor: null,
    detail: `the PR comments connection ${why}`,
  });
  if (connection === null) return unreadable('was missing from the answer');
  const nodes = asArray(connection.nodes);
  if (nodes === null) return unreadable('carried no nodes array');
  for (const node of nodes) {
    const n = asObject(node);
    if (n === null) return unreadable('carried a node that is not an object');
    const author = readAuthor(n.author);
    if (!author.ok) return unreadable(`carried a comment whose ${author.detail}`);
    const body = asString(n.body);
    if (body === null) return unreadable('carried a comment with no body');
    const createdAt = asString(n.createdAt);
    if (createdAt === null) return unreadable('carried a comment with no createdAt');
    entries.push({ isBot: author.isBot, createdAt, dispositions: dispositionedRootIds(body) });
  }
  const info = readPageInfo(connection);
  if (!info.ok) return unreadable(info.detail);
  return { entries, hasNext: info.hasNext, cursor: info.cursor };
}

/** Read one `gh api graphql` response body into a classified page. */
function parsePage(raw: string, byBranch: boolean): PageRead {
  let body: unknown;
  // totem-context: NOT a swallowed error — an unreadable response body is the
  // gate's UNEVALUABLE class, and this returns it NAMED, which the caller turns
  // into a `deny` (strict) or a `warn` (pilot) plus a stderr line. Throwing here
  // would surface as the wrapper's generic fail-closed arm and lose the reason;
  // the fail-loud property is kept by never returning a clean read (Tenet 4).
  try {
    body = JSON.parse(raw);
    // totem-context: intentional degradation — see the directive above the try; dual placement so the rule reads either the catch-keyword line or the catch body.
  } catch {
    // totem-context: intentional degradation — an unreadable body is the NAMED unevaluable class, never a clean read.
    return { ok: false, detail: 'the gh response was not JSON' };
  }
  const top = asObject(body);
  if (top === null) return { ok: false, detail: 'the gh response was not a JSON object' };

  // GraphQL reports authorization, not-found and rate-limit failures in the
  // BODY, at HTTP 200 — an errors array is a failed read, never an empty one.
  const errors = asArray(top.errors);
  if (errors !== null && errors.length > 0) {
    const first = asObject(errors[0]);
    const message = asString(first?.message) ?? 'unnamed GraphQL error';
    return { ok: false, detail: `the GraphQL read returned an error: ${message}` };
  }

  const repository = asObject(asObject(top.data)?.repository);
  if (repository === null) return { ok: false, detail: 'the response carried no repository' };

  let pr: Record<string, unknown> | null;
  if (byBranch) {
    const nodes = asArray(asObject(repository.pullRequests)?.nodes) ?? [];
    pr = asObject(nodes[0]);
    if (pr === null) return { ok: false, detail: 'no open pull request has that head branch' };
  } else {
    pr = asObject(repository.pullRequest);
    if (pr === null)
      return { ok: false, detail: 'the repository has no pull request with that number' };
  }

  const number = typeof pr.number === 'number' ? pr.number : null;
  const headRefOid = asString(pr.headRefOid);
  const mergeStateStatus = asString(pr.mergeStateStatus);
  if (number === null || headRefOid === null || mergeStateStatus === null) {
    return {
      ok: false,
      detail: 'the pull request answer was missing number, headRefOid or mergeStateStatus',
    };
  }

  // Predicate 1 reads the rollup off `commits(last: 1)`. That is only the head
  // commit's rollup if the node IS the head commit, so the identity is checked
  // rather than assumed (mmnto-ai/totem#2800 fold F7): a rollup read off some
  // other commit would be a green light for code that is not what merges.
  const commitNodes = asArray(asObject(pr.commits)?.nodes) ?? [];
  if (commitNodes.length === 0) {
    return {
      ok: false,
      detail: 'the pull request answered no commits — the head commit rollup could not be read',
    };
  }
  const commit = asObject(asObject(commitNodes[0])?.commit);
  const commitOid = asString(commit?.oid);
  if (commitOid === null) {
    return {
      ok: false,
      detail: 'the head commit answered no oid — the rollup cannot be attributed',
    };
  }
  if (commitOid.toLowerCase() !== headRefOid.toLowerCase()) {
    return {
      ok: false,
      detail: `the status-check rollup belongs to ${shortSha(commitOid)}, not the head commit ${shortSha(headRefOid)}`,
    };
  }
  const rollup = asObject(commit?.statusCheckRollup);
  // A rollup that exists but carries no `contexts` connection is an unreadable
  // answer, NOT the zero-checks fact (R5): the fact needs the rollup itself to
  // report an empty context list.
  if (rollup !== null && asObject(rollup.contexts) === null) {
    return {
      ok: false,
      detail:
        'the status-check rollup carried no contexts connection — the check list is unreadable',
    };
  }
  const checks = readChecks(rollup);
  if (checks.detail !== undefined) return { ok: false, detail: checks.detail };
  // The two review connections are held to the SAME bar as the checks
  // connection: an answer that is missing or malformed is a failed read, named,
  // never an empty list (mmnto-ai/totem#2844 round 1).
  const reviews = readReviews(asObject(pr.reviews));
  if (reviews.detail !== undefined) return { ok: false, detail: reviews.detail };
  const threads = readThreads(asObject(pr.reviewThreads));
  if (threads.detail !== undefined) return { ok: false, detail: threads.detail };
  // The evidence surface (mmnto-ai/totem#2861) is held to the same bar.
  const prComments = readPrComments(asObject(pr.comments));
  if (prComments.detail !== undefined) return { ok: false, detail: prComments.detail };

  return {
    ok: true,
    page: {
      number,
      headRefOid: headRefOid.toLowerCase(),
      mergeStateStatus,
      isDraft: pr.isDraft === true,
      rollupPresent: rollup !== null,
      rollupState: asString(rollup?.state),
      rollupTotalCount: asObject(rollup?.contexts)?.totalCount ?? null,
      checks: checks.entries,
      checksHasNext: checks.hasNext,
      checksCursor: checks.cursor,
      reviews: reviews.entries,
      reviewsHasNext: reviews.hasNext,
      reviewsCursor: reviews.cursor,
      threads: threads.entries,
      threadsHasNext: threads.hasNext,
      threadsCursor: threads.cursor,
      prComments: prComments.entries,
      commentsHasNext: prComments.hasNext,
      commentsCursor: prComments.cursor,
    },
  };
}

// ─── Severity read (predicate 4) ────────────────────────────────────────────

/**
 * The severity read is EXACT-BY-MARKER: it matches each bot's own STRUCTURED
 * severity label and nothing else. Prose is never read
 * (mmnto-ai/totem#2800 fold round 2, F4; round 3 F4/F5/F7/F11).
 *
 * Which forms are OBSERVED and which are DOCUMENTED-BUT-UNOBSERVED is stated
 * per arm, because the two are not the same evidence:
 *   - **greptile** — a badge image whose alt text is the priority:
 *     `<a href="#"><img alt="P1" src="…/badges/p1.svg…" align="top"></a>`.
 *     OBSERVED in the corpus: `P1` (high) and `P2` (not high). `P0` is
 *     DOCUMENTED-BUT-UNOBSERVED — greptile publishes the `p0.svg` badge, so the
 *     arm accepts it; no thread in the window carries one. Single quotes are
 *     accepted beside double (`alt='P1'`) — HTML permits either and the read
 *     must not turn on the quote style.
 *   - **gemini-code-assist** — a priority image whose alt text is the level:
 *     `![high](https://www.gstatic.com/codereviewagent/high-priority.svg)`.
 *     OBSERVED: `high`. There is NO `critical` arm: the corresponding asset
 *     404s and GCA's published rubric emits `high` as its top level, so an arm
 *     for it would be inference, not transcription (round 3, F5).
 *   - **CodeRabbit** — an emphasis-wrapped label that OPENS a table cell or a
 *     line. CodeRabbit's severity scale is Critical / Major / Minor / Trivial;
 *     `Potential issue` is its issue-CLASS label, carried here because the
 *     user-level prototype matched it and it marks a blocking finding.
 *     OBSERVED: `_🟠 Major_` (high), `_🟡 Minor_` and `_🔵 Trivial_` (not
 *     high). DOCUMENTED-BUT-UNOBSERVED: `_🔴 Critical_` and
 *     `_⚠️ Potential issue_` — in CodeRabbit's own label vocabulary, absent
 *     from this window. The label must FILL its cell: the emphasis plus the
 *     cell/line boundary are what separate a LABEL from a word in a sentence.
 *
 * CODE IS NOT A LABEL (round 3, F4). Fenced blocks (``` … ```, ~~~ … ~~~) and
 * inline code spans are stripped before the scan. A bot that QUOTES a marker —
 * a CodeRabbit Minor whose suggestion block quotes this very file, which
 * carries every marker in its docstring — would otherwise read as HIGH and
 * false-deny the gate's own maintenance PR.
 *
 * FALSE-POSITIVE BUDGET (ADR-109: a non-exact-match gate ships a stated budget
 * and the fixture that measures it — the `transport-shield` precedent):
 * **ZERO** high-severity reads over the benign corpus in
 * `gate-fixtures/merge-ready/benign-corpus-bot-inlines.json` — every bot inline
 * thread on mmnto-ai/totem#2820 through mmnto-ai/totem#2839, each carrying the
 * severity its own bot declared — and over the quoted-marker row in
 * `gate-fixtures/merge-ready/synthetic-benign-fenced-marker-quote.json`.
 * `merge-ready.test.ts` asserts the read agrees with every one of those
 * declarations, so a marker that widens into prose or into quoted code fails
 * there. The prose arms this replaced did not hold that budget: the greptile
 * **P2** thread on mmnto-ai/totem#2831 read as HIGH through the word "critical"
 * in its explanation — a false deny on a finding its own author ranked below
 * the bar. A miss in the field is a corpus row plus a marker fix, never a
 * hand-carved exemption; the `--pilot` tier exists for a measurement week, and
 * `TOTEM_MERGE_GATE_OVERRIDE=1` is the audited way past one.
 *
 * Out of scope by design, disclosed: a bot that stops emitting a structured
 * label (or a fourth bot) reads as NOT high — the miss direction, a corpus gap
 * to be closed by observation, never a silent deny; a label a bot places
 * somewhere this read does not look (a summary table, a list item, a
 * blockquote) is the same class; a human quoting a bot's label verbatim would
 * read as high, but predicates 2 and 4 both require the thread's ROOT comment
 * to be a known bot login.
 *
 * THE STRIPPER'S EDGES, measured rather than assumed (round 5, F1/F4/F5/F6).
 * It recognises fenced blocks of any backtick or tilde run, `<pre>` blocks,
 * CommonMark indented blocks, and inline spans of any backtick run. At the
 * edges:
 *   - a fence indented under a list item IS stripped, at two spaces or four —
 *     the opener and closer both allow leading blanks;
 *   - a four-backtick fence closed by three has its CONTENTS stripped (the
 *     opener matches three of the four backticks and the fourth reads as the
 *     info string), so only the text AFTER the short closer reaches the scan —
 *     a marker there reads HIGH, the false-deny direction;
 *   - an HTML `<code>` element is NOT stripped at all. A label inside one reads
 *     HIGH wherever it carries its own anchor — a `|` cell delimiter, or a line
 *     start inside a multi-line element — and reads not-high only when it has
 *     neither. False-deny direction.
 * Three edges run the other way, toward ALLOW, by swallowing prose that is not
 * code: a backtick run whose match crosses a paragraph break takes a label
 * sitting between two lone backticks with it; an indented line that follows a
 * prose line is stripped though CommonMark would not open a code block there;
 * and `<pre>` tags quoted inside code spans still act as block delimiters,
 * because the `<pre>` arm runs before the span arm. Measured reach: NONE of
 * the 34 bodies in the checked-in fixtures is affected — every one of them,
 * corpus included, gets the same verdict from its first line alone, and all
 * 16 corpus labels sit on line 0, where no stripper edge can reach them. Each
 * edge is a corpus row plus a stripper fix when one is observed in the field;
 * `TOTEM_MERGE_GATE_OVERRIDE=1` is the audited way past a false deny in the
 * meantime.
 */

/**
 * The glyphs CodeRabbit puts before an un-emphasised severity label — its four
 * severity dots and the warning sign, with and without the variation selector.
 * Built from code points rather than typed, so this source carries no `\u`
 * escape and no pasted emoji (round 3, F7 narrowed this from "any non-ASCII
 * glyph", which let an em-dash-led line read as a label).
 */
const CR_LABEL_GLYPHS = [0x1f534, 0x1f7e0, 0x1f7e1, 0x1f535, 0x26a0]
  .map((cp) => String.fromCodePoint(cp))
  .join('');

/**
 * The variation selector rides AFTER a glyph (`⚠️` is the warning sign plus
 * this), so it is a modifier here rather than a class member: a BARE selector
 * before "major" is not a severity label (round 4, F9).
 */
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

const LABEL_GLYPH = `(?:[${CR_LABEL_GLYPHS}][${VARIATION_SELECTOR}]?)`;

/**
 * The un-emphasised arm is built with the `u` flag so `LABEL_GLYPH` is a
 * CODE-POINT class: without it the astral dots decompose into surrogate halves
 * and a lone surrogate — or a bare variation selector — before "major" matched
 * as if it were a severity glyph (round 4, F9).
 */
const UNEMPHASISED_LABEL = new RegExp(
  `(?:^|\\n)[ \\t]*${LABEL_GLYPH}+[ \\t]*(?:critical|major|potential issue)(?![A-Za-z0-9])`,
  'iu',
);

const HIGH_SEVERITY_MARKERS: readonly RegExp[] = [
  // greptile: the badge's alt attribute, P0/P1 only, quoted either way or
  // unquoted (the lookahead is what ends an unquoted attribute value).
  /<img[^>]*\balt=["']?P[01]["']?(?=[\s/>])/i,
  // gemini-code-assist: the priority image's alt text. `high` only.
  /!\[high\]\(/i,
  // CodeRabbit: an emphasis-wrapped severity label that OPENS a table cell or a
  // line. The `[^A-Za-z0-9\n|]*` arms absorb the glyph and the spaces inside the
  // emphasis; requiring the opening emphasis to sit at a cell/line boundary is
  // what separates a LABEL from an emphasised word inside a sentence.
  /(?:^|\n|\|)[ \t]*[_*]{1,2}[^A-Za-z0-9\n|]*(?:critical|major|potential issue)[^A-Za-z0-9\n|]*[_*]{1,2}/i,
  // CodeRabbit's un-emphasised heading form: the severity glyph, then the
  // label, at the start of a line.
  UNEMPHASISED_LABEL,
];

/**
 * The token every stripped code form leaves behind. It MUST be non-whitespace:
 * replacing a span with a space opened a fresh line/cell-start position, and
 * `` `x`_🟠 Major_ `` then read as a label — a regression this stripper itself
 * introduced (round 4, F2). A word of ASCII letters is neither a boundary the
 * anchors accept nor a glyph the un-emphasised arm reads.
 */
const CODE_PLACEHOLDER = 'CODE';

/**
 * A body with its CODE replaced by {@link CODE_PLACEHOLDER}: fenced blocks
 * first (they can contain backticks), then `<pre>` blocks, then CommonMark's
 * indented blocks, then inline spans of any backtick run. What is left is the
 * bot's prose and its labels — the only text a severity label can legitimately
 * live in (round 3 F4; round 4 F2/F4). An unterminated fence swallows the rest
 * of the body, which is how a markdown renderer reads it too.
 */
function withoutCode(body: string): string {
  return body
    .replace(/^[ \t]*(```+|~~~+)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, CODE_PLACEHOLDER)
    .replace(/^[ \t]*(```|~~~)[\s\S]*$/m, CODE_PLACEHOLDER)
    .replace(/<pre[\s>][\s\S]*?<\/pre>/gi, CODE_PLACEHOLDER)
    .replace(/^(?: {4}|\t)[^\n]*$/gm, CODE_PLACEHOLDER)
    .replace(/(`+)[^`]*?\1/g, CODE_PLACEHOLDER);
}

/**
 * Whether a comment body carries a bot's OWN structured high-severity label —
 * one of {@link HIGH_SEVERITY_MARKERS}, read against the body with every code
 * form replaced first ({@link withoutCode}), so a quoted marker never reads
 * as a label and prose is never matched. `true` is "this finding's author
 * ranked it HIGH/Major/P0/P1"; `false` is "no such label in the prose" — which
 * includes a bot that emits no structured label at all (the disclosed miss
 * direction above).
 */
export function hasHighSeverityMarker(body: string): boolean {
  const prose = withoutCode(body);
  return HIGH_SEVERITY_MARKERS.some((re) => re.test(prose));
}

// ─── Evidence helpers ───────────────────────────────────────────────────────

/** One line: control characters to spaces, runs of whitespace to one, trimmed — never sliced. */
function oneLine(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Bound and sanitize a fragment for a reason / provenance: no control characters, bounded length. */
function bounded(text: string): string {
  const out = oneLine(text);
  return out.length > MERGE_READY_EVIDENCE_MAX
    ? out.slice(0, MERGE_READY_EVIDENCE_MAX - 1) + '…'
    : out;
}

function shortSha(sha: string | null): string {
  return sha === null ? '(unknown)' : sha.slice(0, 12);
}

// ─── The read loop ──────────────────────────────────────────────────────────

/** Everything the predicates read, accumulated across pages. */
interface ReadState {
  number: number;
  headSha: string;
  mergeStateStatus: string;
  isDraft: boolean;
  rollupPresent: boolean;
  rollupState: string | null;
  rollupTotalCount: unknown;
  /** Every rollup context the read materialised, one entry per node — what the count check judges. */
  checks: CheckEntry[];
  /**
   * The checks predicate 1 judges: `checks` with every same-named CheckRun
   * group collapsed to its latest run (mmnto-ai/totem#2879). Filled once
   * every page is in and the rollup has accounted for itself.
   */
  judgedChecks: CheckEntry[];
  /** One record per collapsed name, for the disclosure notices. */
  supersededRuns: SupersededRun[];
  reviews: ReviewEntry[];
  threads: ThreadEntry[];
  /** Every PR-level comment, accumulated across pages — the discharge's evidence surface. */
  prComments: PrCommentEntry[];
  pagesRead: number;
  complete: boolean;
}

type ReadOutcome =
  | { ok: true; state: ReadState }
  | { ok: false; detail: string; pagesRead: number };

function graphqlArgs(
  query: string,
  variables: ReadonlyArray<readonly [string, string | number]>,
): string[] {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of variables) {
    // `-F` sends a typed value (the `$number: Int!` argument requires it); `-f`
    // sends a string. Never a shell string — the runner spawns argv.
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
  }
  return args;
}

/**
 * Run the paginated read. Every failure — a non-zero gh exit, an unparseable
 * body, a GraphQL error, a head that moved between pages, a page budget blown —
 * returns `ok: false` with a NAMED detail. There is no arm that returns a
 * partial read as if it were complete.
 */
function readPullRequest(payload: MergeReadyPayload, runner: GhRunner): ReadOutcome {
  const [owner, name] = payload.repo.split('/');
  const state: ReadState = {
    number: payload.pr ?? 0,
    headSha: '',
    mergeStateStatus: '',
    isDraft: false,
    rollupPresent: false,
    rollupState: null,
    rollupTotalCount: null,
    checks: [],
    judgedChecks: [],
    supersededRuns: [],
    reviews: [],
    threads: [],
    prComments: [],
    pagesRead: 0,
    complete: false,
  };

  let checksDone = false;
  let reviewsDone = false;
  let threadsDone = false;
  let commentsDone = false;
  let checksCursor: string | null = null;
  let reviewsCursor: string | null = null;
  let threadsCursor: string | null = null;
  let commentsCursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    // The branch-keyed document is used ONLY for the first page of a payload
    // with no number; once the number is known every later page targets it, so
    // a PR opened mid-read cannot swap the target under us.
    const byBranch = payload.pr === null && page === 0;
    const query = byBranch ? MERGE_READY_BRANCH_QUERY : MERGE_READY_QUERY;
    const variables: Array<readonly [string, string | number]> = [
      ['owner', owner ?? ''],
      ['name', name ?? ''],
    ];
    if (byBranch) {
      variables.push(['branch', payload.branch ?? '']);
    } else {
      variables.push(['number', state.number]);
    }
    if (checksCursor !== null) variables.push(['checksAfter', checksCursor]);
    if (reviewsCursor !== null) variables.push(['reviewsAfter', reviewsCursor]);
    if (threadsCursor !== null) variables.push(['threadsAfter', threadsCursor]);
    if (commentsCursor !== null) variables.push(['commentsAfter', commentsCursor]);

    const run = runner(graphqlArgs(query, variables));
    state.pagesRead = page + 1;
    if (run.exitCode !== 0) {
      return {
        ok: false,
        detail: `gh api graphql exited ${run.exitCode}: ${bounded(run.stdout)}`,
        pagesRead: state.pagesRead,
      };
    }

    const parsed = parsePage(run.stdout, byBranch);
    if (!parsed.ok) return { ok: false, detail: parsed.detail, pagesRead: state.pagesRead };
    const p = parsed.page;

    if (page === 0) {
      state.number = p.number;
      state.headSha = p.headRefOid;
      state.mergeStateStatus = p.mergeStateStatus;
      state.isDraft = p.isDraft;
      state.rollupPresent = p.rollupPresent;
      state.rollupState = p.rollupState;
      state.rollupTotalCount = p.rollupTotalCount;
    } else if (p.headRefOid !== state.headSha) {
      // The head moved between reads: everything already accumulated describes
      // a commit that is no longer what would merge.
      return {
        ok: false,
        detail: `the head sha moved during evaluation (${shortSha(state.headSha)} → ${shortSha(p.headRefOid)})`,
        pagesRead: state.pagesRead,
      };
    }

    if (!checksDone) {
      state.checks.push(...p.checks);
      checksDone = !p.checksHasNext;
      checksCursor = p.checksCursor;
    }
    if (!reviewsDone) {
      state.reviews.push(...p.reviews);
      reviewsDone = !p.reviewsHasNext;
      reviewsCursor = p.reviewsCursor;
    }
    if (!threadsDone) {
      state.threads.push(...p.threads);
      threadsDone = !p.threadsHasNext;
      threadsCursor = p.threadsCursor;
    }
    if (!commentsDone) {
      state.prComments.push(...p.prComments);
      commentsDone = !p.commentsHasNext;
      commentsCursor = p.commentsCursor;
    }

    if (checksDone && reviewsDone && threadsDone && commentsDone) {
      // The rollup must ACCOUNT for itself before predicate 1 reads it
      // (mmnto-ai/totem#2800 round 4, F3). `totalCount` is judged as the API
      // typed it — a string "3", a boolean, a negative or a fractional number
      // is an unreadable answer, not a count — and once every page is in, the
      // number of contexts the read MATERIALISED must equal the number the
      // rollup CLAIMED. A claim the read did not deliver is an incomplete read
      // (R2), never a smaller green list.
      if (state.rollupPresent) {
        const claimed = state.rollupTotalCount;
        if (typeof claimed !== 'number' || !Number.isInteger(claimed) || claimed < 0) {
          return {
            ok: false,
            detail:
              'the status-check rollup reported a totalCount that is not a non-negative integer (' +
              bounded(typeof claimed === 'string' ? JSON.stringify(claimed) : String(claimed)) +
              ') - the check state is unreadable',
            pagesRead: state.pagesRead,
          };
        }
        if (claimed !== state.checks.length) {
          return {
            ok: false,
            detail:
              'the status-check rollup claims ' +
              String(claimed) +
              ' checks but the read materialised ' +
              String(state.checks.length) +
              ' - the check state is unreadable',
            pagesRead: state.pagesRead,
          };
        }
      }

      // Same-named CheckRuns collapse to their LATEST run before predicate 1
      // reads them (mmnto-ai/totem#2879): a workflow's concurrency group
      // cancels the run a later push or body edit superseded, and the rollup
      // lists BOTH — the cancelled one is not a failing check, it is a
      // replaced one. The judgment needs every duplicate's id; a group with
      // an unreadable id is an unreadable check state, never "the first one".
      // Runs AFTER the count check on purpose: the rollup accounts for the
      // nodes it listed, and the collapse is a read of those nodes.
      const judged = judgeLatestRuns(state.checks);
      if (!judged.ok) {
        return { ok: false, detail: judged.detail, pagesRead: state.pagesRead };
      }
      state.judgedChecks = judged.judged;
      state.supersededRuns = judged.collapsed;

      // R5's zero-checks FACT applies ONLY where the rollup is consistent about
      // it, and that is exactly two shapes: no rollup at all, or a rollup that
      // reports SUCCESS over an empty context list AND counts zero (the count
      // agreement above already holds). Every other shape — a PENDING or
      // FAILURE state with nothing listed, a `state` that is null or not a
      // string — is an unreadable answer, never a green light (fold F7; round 2
      // F3 added the null/non-string state).
      if (state.checks.length === 0 && state.rollupPresent && state.rollupState !== 'SUCCESS') {
        return {
          ok: false,
          detail:
            state.rollupState === null
              ? 'the status-check rollup listed no checks and reported no readable state - the check state is unreadable'
              : 'the status-check rollup reports ' +
                bounded(state.rollupState) +
                ' but listed no checks - the check state is unreadable',
          pagesRead: state.pagesRead,
        };
      }
      state.complete = true;
      return { ok: true, state };
    }
  }

  return {
    ok: false,
    detail: `the read needed more than ${MAX_PAGES} pages; a capped read is never reported as clean`,
    pagesRead: state.pagesRead,
  };
}

// ─── The predicates ─────────────────────────────────────────────────────────

/** A predicate failure: which one, and the evidence that failed it. */
interface Blocked {
  predicate: MergeReadyPredicate;
  evidence: string;
}

/** `mergeStateStatus` values that pass predicate 5. `UNSTABLE` (a non-required check red) is predicate 1's business. */
const MERGE_STATE_PASS = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);
/** Values that fail predicate 5 outright. `DRAFT` is GitHub's own "not ready to merge". */
const MERGE_STATE_DENY = new Map<string, string>([
  ['BEHIND', 'the branch is behind its base — update it before merging'],
  ['DIRTY', 'the merge is conflicted — resolve the conflict before merging'],
  ['BLOCKED', 'branch protection blocks the merge (a required review or check is missing)'],
  ['DRAFT', 'the pull request is still a draft'],
]);

/**
 * Collapse every same-named `CheckRun` group to its LATEST run
 * (mmnto-ai/totem#2879). GitHub's rollup `contexts` lists EVERY check run on
 * the head — a concurrency group's cancelled duplicate beside the run that
 * superseded it — while `gh pr checks` and the merge box show one row per
 * name, judged by the latest run. The rollup's own order is NOT
 * chronological (on mmnto-ai/totem#2877's head the later D1 run was listed
 * before the earlier one), so "last listed wins" is not a rule; the latest
 * run is the one with the greatest `databaseId`, GitHub's check-run id, a
 * single increasing sequence.
 *
 * A group of two or more whose every member does not carry a readable id is
 * an unreadable check state (R2): the latest cannot be derived, and picking
 * one would be a guess dressed as a read. A single run needs no id. Legacy
 * `StatusContext` nodes carry one state per context already and pass through
 * untouched. Output order is first-seen order, so the deny reason's name list
 * reads the way the rollup listed it.
 */
/** A check name that ran more than once on the head, and the run that judged it. */
interface SupersededRun {
  name: string;
  runs: number;
  judgedId: number;
  kind: CheckEntry['kind'];
}

function judgeLatestRuns(
  checks: readonly CheckEntry[],
): { ok: true; judged: CheckEntry[]; collapsed: SupersededRun[] } | { ok: false; detail: string } {
  const groups = new Map<string, CheckEntry[]>();
  const order: Array<{ key: string } | { entry: CheckEntry }> = [];
  for (const c of checks) {
    // A legacy status passes through; so does a run whose name did not read —
    // grouping the placeholder would fabricate an identity two malformed nodes
    // never shared (leg F10).
    if (c.typename !== 'CheckRun' || c.name === UNNAMED_CHECK) {
      order.push({ entry: c });
      continue;
    }
    const group = groups.get(c.name);
    if (group === undefined) {
      groups.set(c.name, [c]);
      order.push({ key: c.name });
    } else {
      group.push(c);
    }
  }
  const judged: CheckEntry[] = [];
  const collapsed: SupersededRun[] = [];
  for (const slot of order) {
    if ('entry' in slot) {
      judged.push(slot.entry);
      continue;
    }
    const group = groups.get(slot.key)!;
    if (group.length === 1) {
      judged.push(group[0]!);
      continue;
    }
    let latest: CheckEntry | null = null;
    for (const run of group) {
      if (run.runId === null) {
        return {
          ok: false,
          detail:
            'check ' +
            bounded(JSON.stringify(slot.key)) +
            ' ran ' +
            String(group.length) +
            ' times on the head and one of its runs carries no readable databaseId - the latest run cannot be derived, the check state is unreadable',
        };
      }
      if (latest === null || run.runId > (latest.runId as number)) latest = run;
    }
    judged.push(latest as CheckEntry);
    collapsed.push({
      name: slot.key,
      runs: group.length,
      judgedId: (latest as CheckEntry).runId as number,
      kind: (latest as CheckEntry).kind,
    });
  }
  return { ok: true, judged, collapsed };
}

function summarizeChecks(
  judged: readonly CheckEntry[],
  materialised: number,
): {
  total: number;
  success: number;
  pending: number;
  failing: number;
  superseded: number;
} {
  let success = 0;
  let pending = 0;
  let failing = 0;
  for (const c of judged) {
    if (c.kind === 'success') success++;
    else if (c.kind === 'pending') pending++;
    else failing++;
  }
  return {
    total: judged.length,
    success,
    pending,
    failing,
    superseded: materialised - judged.length,
  };
}

/**
 * The authors whose LATEST decision review is CHANGES_REQUESTED. `COMMENTED`
 * reviews are not decisions and never supersede (GitHub's own semantics); a
 * later APPROVED or DISMISSED from the same reviewer does.
 */
function changesRequestedBy(reviews: readonly ReviewEntry[]): string[] {
  const DECISIONS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);
  const latest = new Map<string, { state: string; at: string }>();
  for (const r of reviews) {
    if (!DECISIONS.has(r.state)) continue;
    const at = r.submittedAt ?? '';
    const seen = latest.get(r.login);
    // Ties (or a missing timestamp) fall back to array order, which the API
    // returns chronologically — the later row wins.
    if (seen === undefined || at >= seen.at) latest.set(r.login, { state: r.state, at });
  }
  const out: string[] = [];
  for (const [login, decision] of latest) {
    if (decision.state === 'CHANGES_REQUESTED') out.push(login);
  }
  return out.sort();
}

/** Unresolved, non-outdated threads whose ROOT comment is a known review bot. */
function unresolvedBotThreads(threads: readonly ThreadEntry[]): ThreadEntry[] {
  return threads.filter(
    (t) =>
      !t.isResolved &&
      !t.isOutdated &&
      t.rootLogin !== null &&
      isBotReviewerLoginExact(t.rootLogin),
  );
}

/**
 * HIGH/Major bot inlines that CURRENTLY apply to the head commit, before the
 * discharge read below.
 *
 * The comparison is `comment.commit.oid`, the commit the finding applies to
 * NOW (GitHub re-points it as the diff moves; it is the REST `commit_id` the
 * charter's predicate (c) names), never `originalCommit.oid`, the commit it was
 * written against — a predicate keyed on the write-time commit goes inert the
 * moment the branch advances, which is exactly the inert state fold F2 of
 * mmnto-ai/totem#2800 removed.
 *
 * Predicate 4's distinct territory, the one predicate 2 cannot reach: a HIGH
 * finding whose thread is RESOLVED while the comment still applies to the head
 * commit. Since mmnto-ai/totem#2861 that territory splits by HOW the thread
 * was resolved — see {@link dischargeOf}: through the disposition path the
 * finding is DISCHARGED and no longer counts; by a bare resolve it still
 * applies and the floor still refuses the merge. Predicate 2 keeps its own
 * rule (unresolved AND non-outdated, any severity) and still fires first when
 * both match — which is what makes the resolve a REQUIRED step of the
 * disposition path rather than an optional one.
 */
function botHighInlinesOnHead(threads: readonly ThreadEntry[], headSha: string): ThreadEntry[] {
  return threads.filter(
    (t) =>
      t.rootLogin !== null &&
      isBotReviewerLoginExact(t.rootLogin) &&
      t.rootCommit !== null &&
      t.rootCommit.toLowerCase() === headSha &&
      hasHighSeverityMarker(t.rootBody),
  );
}

/** How a HIGH-on-head thread was answered — the two arms of the disposition path, or neither. */
type Discharge = 'in-thread-reply' | 'pr-level-disposition' | 'none';

/**
 * The disposition path, read off the same page as the predicate
 * (mmnto-ai/totem#2861): a thread is DISCHARGED when it is RESOLVED and a
 * disposition NAMES it — a non-bot reply after the root inside the thread (it
 * names the thread by being in it), or a non-bot PR-level comment created
 * STRICTLY after the root that carries a `disposition:` line for this
 * thread's root comment id ({@link DISPOSITION_LINE}). `none` is the bare
 * resolve — a click with no disposition naming it, the fail-closed arm the
 * ruling names — and an unresolved thread alike; predicate 2 catches the
 * unresolved one first, so the resolve is a REQUIRED step of the path, never
 * an optional one. A round disposition that answered OTHER threads is `none`
 * for this one: the id is what closes the class two round-keyed reads left
 * open (the falsification legs' r-f1 and r2-f1, both executed on the built
 * core), and the operator ruled for the thread-level line on 2026-09-16.
 *
 * Two deliberate differences from the `totem resolve-threads` evidence rule
 * (mmnto-ai/totem#2841 R2), which this otherwise mirrors. The verb decides
 * whether a thread MAY be resolved and accepts any non-bot PR-level comment
 * after the root, disclosing that an operator's trigger comment counts; this
 * predicate decides whether a resolved HIGH is DISPOSITIONED, and a trigger,
 * a gate-read note, merge chatter or another thread's disposition must not
 * discharge it — so the PR-level arm reads the line that names this thread.
 * A thread the verb resolved on the strength of a trigger therefore stays
 * applying here until a disposition naming it is posted: the stricter side of
 * the asymmetry, by design. `createdAt` is a comment's CREATION instant and an
 * edit does not move it, so a line edited into a comment created after the
 * root reads as posted then, and a line edited into one created before the
 * root never counts (r3-f12) — a late line is posted as a new comment, which
 * is what the calibration replay did. And an unparseable
 * instant on either side is `none` here as it is there — the conservative
 * direction — never an unreadable page (the strict reader has already refused
 * a root without a string `createdAt`).
 *
 * A thread with more comments than the ten-comment window is judged on what
 * was read: evidence found inside the window or at PR level discharges it, and
 * a window with none is a bare resolve whose reason NAMES the window — a
 * fact-side deny at every tier, never the unevaluable class, which pilot maps
 * to `warn` and which would have let the shape pre-cure denied at both tiers
 * stop blocking (leg f2).
 */
function dischargeOf(thread: ThreadEntry, prComments: readonly PrCommentEntry[]): Discharge {
  if (!thread.isResolved) return 'none';
  if (thread.humanReplies > 0) return 'in-thread-reply';
  const rootAt = Date.parse(thread.rootCreatedAt);
  if (Number.isNaN(rootAt)) return 'none';
  if (thread.rootId === null) return 'none';
  for (const c of prComments) {
    if (c.isBot || !c.dispositions.includes(thread.rootId)) continue;
    const at = Date.parse(c.createdAt);
    if (!Number.isNaN(at) && at > rootAt) return 'pr-level-disposition';
  }
  return 'none';
}

/** Predicate 4's read: the bot HIGH inlines on the head, split by {@link dischargeOf}, with the arm counts. */
function triageHighInlines(
  threads: readonly ThreadEntry[],
  headSha: string,
  prComments: readonly PrCommentEntry[],
): {
  applying: ThreadEntry[];
  discharged: ThreadEntry[];
  by: { inThreadReply: number; prLevelDisposition: number };
} {
  const applying: ThreadEntry[] = [];
  const discharged: ThreadEntry[] = [];
  const by = { inThreadReply: 0, prLevelDisposition: 0 };
  for (const t of botHighInlinesOnHead(threads, headSha)) {
    const discharge = dischargeOf(t, prComments);
    if (discharge === 'none') {
      applying.push(t);
    } else {
      discharged.push(t);
      if (discharge === 'in-thread-reply') by.inThreadReply++;
      else by.prLevelDisposition++;
    }
  }
  return { applying, discharged, by };
}

/**
 * Bot HIGH inlines whose `comment.commit` came back NULL — the predicate's
 * input is missing, so whether they apply to the head is UNKNOWN
 * (mmnto-ai/totem#2800 round 2, F8). R2: an unreadable input is never a pass,
 * so these never fall out of the filter above and read as "not on head".
 * They make the evaluation UNEVALUABLE, named on stderr, only when no
 * predicate ahead of them in charter order has already failed: a failing
 * check, an unresolved bot thread, a standing CHANGES_REQUESTED or a
 * placeable HIGH inline is a fact and denies first, and that verdict names
 * its own cause, not these (the PR's review round; see the call site).
 */
function unreadableCommitHighInlines(threads: readonly ThreadEntry[]): ThreadEntry[] {
  return threads.filter(
    (t) =>
      t.rootLogin !== null &&
      isBotReviewerLoginExact(t.rootLogin) &&
      t.rootCommit === null &&
      hasHighSeverityMarker(t.rootBody),
  );
}

// ─── The evaluation ─────────────────────────────────────────────────────────

/** Read `gh --version` through the seam. A failure here IS the "gh unavailable" failure mode. */
function readGhVersion(
  runner: GhRunner,
): { ok: true; version: string } | { ok: false; detail: string } {
  const run = runner(['--version']);
  if (run.exitCode !== 0) {
    return {
      ok: false,
      detail: `gh is unavailable or unauthenticated (gh --version exited ${run.exitCode}: ${bounded(run.stdout)})`,
    };
  }
  const match = /gh version (\S+)/.exec(run.stdout);
  return {
    ok: true,
    version: match?.[1] !== undefined ? `gh ${match[1]}` : 'gh (version unknown)',
  };
}

/**
 * Evaluate the merge-ready floor. Pure with respect to state: it reads GitHub
 * through the injected runner and returns a verdict, its evidence, and the
 * stderr lines the host must print. It writes nothing.
 */
export function evaluateMergeReady(
  payload: unknown,
  options: MergeReadyOptions,
): MergeReadyEvaluation {
  const parsed = parseMergeReadyPayload(payload);
  const tier: GateTier = options.tier ?? 'strict';
  const env = options.env ?? process.env;
  const now = options.now ?? ((): Date => new Date());
  const checkedAt = now().toISOString();
  const notices: string[] = [];
  const override = env[MERGE_READY_OVERRIDE_ENV] === '1';

  const detail: MergeReadyProvenanceDetail = {
    repo: parsed.repo,
    pr: parsed.pr,
    headSha: null,
    checks: { total: 0, success: 0, pending: 0, failing: 0, superseded: 0 },
    threads: { unresolvedBot: 0, pagesRead: 0, complete: false },
    changesRequestedBy: [],
    highInline: 0,
    dischargedHigh: 0,
    dischargedBy: { inThreadReply: 0, prLevelDisposition: 0 },
    mergeStateStatus: null,
    evaluatedAt: checkedAt,
    evaluatedBy: 'gh (not read)',
  };

  /** The UNEVALUABLE class: `deny` under strict, `warn` under pilot — never `allow`. */
  const unevaluable = (why: string): MergeReadyEvaluation => {
    notices.push(
      `${MERGE_READY_NOTICE_PREFIX} could not derive the merge floor for ${parsed.repo}#${parsed.pr ?? parsed.branch ?? '?'}: ${why} (tier=${tier} → ${tier === 'pilot' ? 'warn' : 'deny'}).`,
    );
    if (override) return allowByOverride(`the read failed: ${why}`);
    return {
      verdict: {
        disposition: tier === 'pilot' ? 'warn' : 'deny',
        reason: `merge-ready could not derive: ${why}.`,
        provenance: {
          source: MERGE_READY_SOURCE,
          ref: 'unevaluable',
          matched: bounded(why),
          checkedAt,
          detail: { ...detail },
        },
      },
      detail,
      notices,
    };
  };

  /** The audited bypass: `allow` plus one line naming what would have denied. */
  const allowByOverride = (wouldHaveDenied: string): MergeReadyEvaluation => {
    detail.override = true;
    notices.push(
      `${MERGE_READY_NOTICE_PREFIX} OVERRIDE (${MERGE_READY_OVERRIDE_ENV}=1): allowing ${parsed.repo}#${parsed.pr ?? detail.pr ?? '?'} at head ${shortSha(detail.headSha)} — would have denied: ${wouldHaveDenied}.`,
    );
    return {
      verdict: {
        disposition: 'allow',
        reason: `Allowed by ${MERGE_READY_OVERRIDE_ENV}=1 (audited). Would have denied: ${wouldHaveDenied}.`,
        provenance: {
          source: MERGE_READY_SOURCE,
          ref: 'override',
          matched: bounded(wouldHaveDenied),
          checkedAt,
          detail: { ...detail },
        },
      },
      detail,
      notices,
    };
  };

  // An argument the wrapper could not project into a PR (an unexpanded shell
  // variable) is UNEVALUABLE before any read: there is nothing to query, and
  // guessing would judge the wrong PR (mmnto-ai/totem#2800 fold F13). No `gh`
  // runs on this path.
  if (parsed.unresolvedTarget !== undefined) {
    return unevaluable(
      `shell variable not expanded — pass a literal PR number or URL (the command named "${bounded(parsed.unresolvedTarget)}")`,
    );
  }

  const version = readGhVersion(options.runner);
  if (!version.ok) return unevaluable(version.detail);
  detail.evaluatedBy = version.version;

  const read = readPullRequest(parsed, options.runner);
  if (!read.ok) {
    detail.threads.pagesRead = read.pagesRead;
    return unevaluable(read.detail);
  }
  const state = read.state;

  detail.pr = state.number;
  detail.headSha = state.headSha;
  detail.mergeStateStatus = state.mergeStateStatus;
  detail.checks = summarizeChecks(state.judgedChecks, state.checks.length);
  // A superseded run is a check the read SAW and set aside; the record must
  // say so, name by name, and name the run that stood in for it
  // (mmnto-ai/totem#2879). One line per collapsed name, on purpose: a single
  // line under the evidence bound lost its tail at three names (leg F1; a
  // head on main carried five), and a disclosure that trails off is not one.
  // Each line is sanitised, never sliced — it is a notice, not `matched`.
  for (const run of state.supersededRuns) {
    notices.push(
      `${MERGE_READY_NOTICE_PREFIX} ${parsed.repo}#${state.number} at ${shortSha(state.headSha)}: check ${oneLine(JSON.stringify(run.name))} ran ${run.runs} times on the head commit — judged by its latest run ${run.judgedId} (${run.kind}), the greatest check-run id; ${run.runs - 1} superseded run(s) not counted (mmnto-ai/totem#2879).`,
    );
  }
  detail.threads = {
    unresolvedBot: unresolvedBotThreads(state.threads).length,
    pagesRead: state.pagesRead,
    complete: state.complete,
  };
  detail.changesRequestedBy = changesRequestedBy(state.reviews);
  const high = triageHighInlines(state.threads, state.headSha, state.prComments);
  detail.highInline = high.applying.length;
  detail.dischargedHigh = high.discharged.length;
  detail.dischargedBy = { ...high.by };
  // The audit breadcrumb for what the predicate RELEASED (mmnto-ai/totem#2861):
  // a discharged HIGH is a bot finding the round answered, and the record
  // must show it was read and discharged — and by which arm — never that it
  // was not seen.
  if (high.discharged.length > 0) {
    notices.push(
      `${MERGE_READY_NOTICE_PREFIX} ${parsed.repo}#${state.number} at ${shortSha(state.headSha)}: ${high.discharged.length} HIGH/Major bot inline(s) on the head commit discharged through the disposition path (thread resolved; ${high.by.inThreadReply} by a non-bot in-thread reply, ${high.by.prLevelDisposition} by a PR-level disposition line naming the thread after its root) — no longer applying (mmnto-ai/totem#2861).`,
    );
  }

  // The predicates are read BEFORE the unreadable-commit arm below: a failure
  // that stands in charter order ahead of predicate 4 is a fact, and a tier
  // never softens a fact — the arm that returned first here turned a failing
  // check plus one unplaceable HIGH inline into the UNEVALUABLE class, which
  // pilot maps to `warn` (mmnto-ai/totem#2844 round 1, CodeRabbit).
  const blocked = firstFailure(state, detail, high.applying);

  // A bot HIGH inline whose `comment.commit` came back null cannot be placed
  // against the head, so predicate 4's input is missing for it: unevaluable and
  // NAMED, never a silent pass (round 2, F8). It still preempts predicate 5 —
  // predicate 4's missing input comes before predicate 5 in charter order —
  // but never a failure of predicates 1–3 or a READABLE predicate-4 failure.
  const unreadable = unreadableCommitHighInlines(state.threads);
  if ((blocked === null || blocked.predicate === 'merge-state') && unreadable.length > 0) {
    const first = unreadable[0]!;
    return unevaluable(
      `${unreadable.length} HIGH bot inline(s) carry no commit, so predicate 4 cannot place them against the head — the first is ${first.rootLogin ?? 'a bot'}: "${bounded(first.rootBody)}"`,
    );
  }

  // The caller's local head is evidence, not a predicate: a local branch can
  // legitimately sit ahead of or behind the PR head, and the charter's floor
  // does not include "your checkout matches". A mismatch is NAMED, never silent.
  if (parsed.headSha !== undefined && parsed.headSha !== state.headSha) {
    notices.push(
      `${MERGE_READY_NOTICE_PREFIX} the payload head sha (${shortSha(parsed.headSha)}) is not the PR head (${shortSha(state.headSha)}); the floor was read against the PR head.`,
    );
  }

  // R5: zero checks passes predicate 1 as a FACT, with the count in provenance
  // and one stderr line. Branch protection owns "must have checks".
  if (detail.checks.total === 0) {
    notices.push(
      `${MERGE_READY_NOTICE_PREFIX} ${parsed.repo}#${state.number} at ${shortSha(state.headSha)} has ZERO status checks${state.rollupPresent ? '' : ' (no rollup on the head commit)'} — predicate 1 passes as a fact; branch protection, not this gate, decides whether zero checks may merge.`,
    );
  }

  if (override) {
    return allowByOverride(
      blocked === null
        ? 'nothing (every predicate passed)'
        : `${blocked.predicate} — ${blocked.evidence}`,
    );
  }

  // `mergeStateStatus: UNKNOWN` means GitHub has not computed mergeability yet:
  // an input that failed to derive, not a fact — the UNEVALUABLE class.
  if (blocked === null && state.mergeStateStatus === 'UNKNOWN') {
    return unevaluable(
      'GitHub has not computed mergeability yet (mergeStateStatus: UNKNOWN) — retry',
    );
  }
  if (blocked === null && !MERGE_STATE_PASS.has(state.mergeStateStatus)) {
    return unevaluable(
      `mergeStateStatus "${bounded(state.mergeStateStatus)}" is not a value this gate reads`,
    );
  }

  if (blocked !== null) {
    return {
      verdict: {
        disposition: 'deny',
        reason: `${parsed.repo}#${state.number} is not merge-ready: ${blocked.evidence}.`,
        provenance: {
          source: MERGE_READY_SOURCE,
          ref: blocked.predicate,
          matched: bounded(blocked.evidence),
          checkedAt,
          detail: { ...detail },
        },
      },
      detail,
      notices,
    };
  }

  const botReviewSeen = state.threads.some(
    (t) => t.rootLogin !== null && isBotReviewerLoginExact(t.rootLogin),
  );
  const factClause = botReviewSeen ? '' : ' No bot review present — predicates 2–4 pass as a fact.';
  return {
    verdict: {
      disposition: 'allow',
      reason: `${parsed.repo}#${state.number} at ${shortSha(state.headSha)} meets the merge-ready floor (${detail.checks.success}/${detail.checks.total} checks green, mergeStateStatus ${state.mergeStateStatus}).${factClause}`,
      provenance: {
        source: MERGE_READY_SOURCE,
        ref: 'merge-ready',
        matched: state.headSha,
        checkedAt,
        detail: { ...detail },
      },
    },
    detail,
    notices,
  };
}

/**
 * The FIRST predicate that fails, in charter order, or null when the floor is
 * met. `applyingHigh` is predicate 4's set after the discharge read — the
 * caller triages once so the provenance counts and the verdict read the same
 * list.
 */
function firstFailure(
  state: ReadState,
  detail: MergeReadyProvenanceDetail,
  applyingHigh: readonly ThreadEntry[],
): Blocked | null {
  // 1. checks
  if (detail.checks.failing > 0) {
    const names = state.judgedChecks
      .filter((c) => c.kind === 'failing')
      .map((c) => c.name)
      .join(', ');
    return {
      predicate: 'checks',
      evidence: `${detail.checks.failing} of ${detail.checks.total} status checks are failing (${bounded(names)})`,
    };
  }
  if (detail.checks.pending > 0) {
    const names = state.judgedChecks
      .filter((c) => c.kind === 'pending')
      .map((c) => c.name)
      .join(', ');
    return {
      predicate: 'checks',
      evidence: `${detail.checks.pending} of ${detail.checks.total} status checks are still running (${bounded(names)})`,
    };
  }

  // 2. unresolved, non-outdated bot threads
  const unresolved = unresolvedBotThreads(state.threads);
  if (unresolved.length > 0) {
    const first = unresolved[0]!;
    return {
      predicate: 'unresolved-bot-threads',
      evidence: `${unresolved.length} unresolved bot review thread(s) — the first is ${first.rootLogin ?? 'a bot'}: "${bounded(first.rootBody)}"`,
    };
  }

  // 3. un-superseded CHANGES_REQUESTED
  if (detail.changesRequestedBy.length > 0) {
    return {
      predicate: 'changes-requested',
      evidence: `CHANGES_REQUESTED stands from ${detail.changesRequestedBy.join(', ')}`,
    };
  }

  // 4. HIGH/Major bot inline on the head commit, not discharged
  if (applyingHigh.length > 0) {
    const first = applyingHigh[0]!;
    // Name the bare-resolve shape when that is what the first one is — the
    // operator's cure differs (post the disposition line) from the unanswered
    // shape's (answer the finding) — and name the window when the thread had
    // more comments than the read fetched. The LINE comes first in the clause
    // and the clause before the quoted body, so the id survives the
    // 160-character bound on `provenance.matched` (the third leg's r3-f3: a
    // clause that led with prose cut the id off at character 161); the tests
    // pin the id on `matched` for both clauses. With more than one applying,
    // the reason names the first and says where the rest are listed.
    const line =
      first.rootId === null
        ? 'no line can name it (its root comment id was not readable)'
        : `no "disposition: ${first.rootId} <verb>" line after its root`;
    const bareResolve = !first.isResolved
      ? ''
      : first.commentsComplete
        ? ` — resolved, ${line} and no non-bot reply in its thread (a bare resolve, or a round disposition that did not name this thread, does not discharge a HIGH; mmnto-ai/totem#2861)`
        : ` — resolved, ${line} and no non-bot reply in the ten comments read (the thread has more; mmnto-ai/totem#2861)`;
    const rest =
      applyingHigh.length > 1
        ? ` (the first of ${applyingHigh.length}; a \`totem resolve-threads\` dry run lists every root id)`
        : '';
    return {
      predicate: 'high-severity-inline',
      evidence: `${applyingHigh.length} HIGH/Major bot inline(s) still applying to the head commit${bareResolve} — the first is ${first.rootLogin ?? 'a bot'}${rest}: "${bounded(first.rootBody)}"`,
    };
  }

  // 5. GitHub's own mergeability
  const denyReason = MERGE_STATE_DENY.get(state.mergeStateStatus);
  if (denyReason !== undefined) {
    return {
      predicate: 'merge-state',
      evidence: `mergeStateStatus is ${state.mergeStateStatus} — ${denyReason}`,
    };
  }

  return null;
}

// ─── The registry entry ─────────────────────────────────────────────────────

/**
 * The production gh seam: spawn `gh` with an argv (never a shell string) and
 * report `{ stdout, exitCode }`. A spawn failure (gh absent) and a non-zero
 * exit are the SAME shape here — both are "the read did not answer", which the
 * evaluator turns into the named UNEVALUABLE class.
 *
 * When gh writes its diagnosis to stderr and nothing to stdout (the missing
 * binary, an auth failure), the stderr text is returned as `stdout` so the
 * reason can name what gh said; the exit code is what decides.
 */
export function makeGhRunner(timeoutMs = 30_000, execute: typeof safeExec = safeExec): GhRunner {
  return (args: string[]) => {
    // totem-context: NOT a swallowed error — the seam's contract is
    // `{ stdout, exitCode }`, so a spawn failure (gh absent) and a non-zero exit
    // must arrive at the evaluator the SAME way: as a read that did not answer,
    // which becomes a NAMED unevaluable verdict carrying what gh said. Throwing
    // instead would erase that text and land in the wrapper's generic
    // fail-closed arm; nothing here can return a clean read (Tenet 4).
    try {
      return {
        stdout: execute('gh', args, { timeout: timeoutMs, trim: false }),
        exitCode: 0,
      };
      // totem-context: intentional degradation — see the directive above the try; dual placement so the rule reads either the catch-keyword line or the catch body.
    } catch (err) {
      // totem-context: intentional degradation — a gh that did not answer is the NAMED unevaluable class, carrying what gh said; never a clean read.
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
      const status = typeof fields.status === 'number' ? fields.status : 1;
      return { stdout: text, exitCode: status === 0 ? 1 : status };
    }
  };
}

/**
 * The registry evaluator. Builds the production runner lazily (so no gh is
 * spawned unless this gate actually runs), evaluates, and prints the gate's
 * stderr lines through the injected sink.
 */
export const mergeReadyEvaluator: GateEvaluator = (payload, _totemDir, context): GateVerdict => {
  const runner = context?.ghRunner ?? makeGhRunner();

  const evaluation = evaluateMergeReady(payload, {
    runner,
    tier: context?.tier,
    env: context?.env,
  });

  const write = context?.writeStderr ?? ((line: string): void => void process.stderr.write(line));
  for (const notice of evaluation.notices) {
    write(`${notice}\n`);
  }
  return evaluation.verdict;
};
