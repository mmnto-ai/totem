import { isBotReviewerLoginExact } from './bot-identity.js';
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
 *                                to the head commit (`comment.commit.oid`,
 *                                thread resolution ignored)
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
  checks: { total: number; success: number; pending: number; failing: number };
  threads: { unresolvedBot: number; pagesRead: number; complete: boolean };
  changesRequestedBy: string[];
  highInline: number;
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
 * branch-keyed documents cannot drift apart. The three paginated connections
 * each take their own cursor variable, declared by the operation.
 *
 * `comments(first: 10)` is deliberate: only the ROOT comment of a thread is
 * judged (it is the finding; the rest are the discussion), matching how triage
 * reads a thread. The later comments are fetched for evidence, not for a
 * predicate, so a thread with more than ten comments is not an incomplete read.
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
              ... on CheckRun { name status conclusion }
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
        nodes {
          author { login }
          body
          commit { oid }
          originalCommit { oid }
        }
      }
    }
  }
}`;

const SHARED_VARS =
  '$owner: String!, $name: String!, $reviewsAfter: String, $threadsAfter: String, $checksAfter: String';

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

/** One classified status check. */
interface CheckEntry {
  name: string;
  kind: 'success' | 'pending' | 'failing';
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
  checks: CheckEntry[];
  checksHasNext: boolean;
  checksCursor: string | null;
  reviews: ReviewEntry[];
  reviewsHasNext: boolean;
  reviewsCursor: string | null;
  threads: ThreadEntry[];
  threadsHasNext: boolean;
  threadsCursor: string | null;
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
const PENDING_CONTEXT_STATES = new Set(['PENDING', 'EXPECTED']);

function readPageInfo(connection: Record<string, unknown> | null): {
  hasNext: boolean;
  cursor: string | null;
} {
  const info = asObject(connection?.pageInfo);
  return {
    hasNext: info?.hasNextPage === true,
    cursor: asString(info?.endCursor),
  };
}

function readChecks(rollup: Record<string, unknown> | null): {
  entries: CheckEntry[];
  hasNext: boolean;
  cursor: string | null;
  detail?: string;
} {
  const contexts = asObject(rollup?.contexts);
  const nodes = asArray(contexts?.nodes) ?? [];
  const entries: CheckEntry[] = [];
  for (const node of nodes) {
    const n = asObject(node);
    if (n === null)
      return { entries, hasNext: false, cursor: null, detail: 'a check node was not an object' };
    const typename = asString(n.__typename);
    if (typename === 'CheckRun') {
      const name = asString(n.name) ?? '(unnamed check)';
      const status = asString(n.status) ?? '';
      const conclusion = asString(n.conclusion);
      if (status !== 'COMPLETED') {
        entries.push({ name, kind: 'pending' });
      } else if (conclusion !== null && SUCCESS_CONCLUSIONS.has(conclusion)) {
        entries.push({ name, kind: 'success' });
      } else {
        entries.push({ name, kind: 'failing' });
      }
    } else if (typename === 'StatusContext') {
      const name = asString(n.context) ?? '(unnamed context)';
      const state = asString(n.state) ?? '';
      if (SUCCESS_CONTEXT_STATES.has(state)) {
        entries.push({ name, kind: 'success' });
      } else if (PENDING_CONTEXT_STATES.has(state)) {
        entries.push({ name, kind: 'pending' });
      } else {
        entries.push({ name, kind: 'failing' });
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
  return { entries, hasNext: info.hasNext, cursor: info.cursor };
}

function readReviews(connection: Record<string, unknown> | null): {
  entries: ReviewEntry[];
  hasNext: boolean;
  cursor: string | null;
} {
  const entries: ReviewEntry[] = [];
  for (const node of asArray(connection?.nodes) ?? []) {
    const n = asObject(node);
    if (n === null) continue;
    const login = asString(asObject(n.author)?.login);
    const state = asString(n.state);
    // A review whose author is a deleted account has `author: null`; it carries
    // no identity to supersede or attribute, so it is skipped (never counted as
    // a CHANGES_REQUESTED nobody can clear).
    if (login === null || state === null) continue;
    entries.push({ login, state, submittedAt: asString(n.submittedAt) });
  }
  const info = readPageInfo(connection);
  return { entries, hasNext: info.hasNext, cursor: info.cursor };
}

function readThreads(connection: Record<string, unknown> | null): {
  entries: ThreadEntry[];
  hasNext: boolean;
  cursor: string | null;
} {
  const entries: ThreadEntry[] = [];
  for (const node of asArray(connection?.nodes) ?? []) {
    const n = asObject(node);
    if (n === null) continue;
    const comments = asArray(asObject(n.comments)?.nodes) ?? [];
    const root = asObject(comments[0]);
    entries.push({
      isResolved: n.isResolved === true,
      isOutdated: n.isOutdated === true,
      rootLogin: asString(asObject(root?.author)?.login),
      rootBody: asString(root?.body) ?? '',
      rootCommit: asString(asObject(root?.commit)?.oid),
      rootOriginalCommit: asString(asObject(root?.originalCommit)?.oid),
    });
  }
  const info = readPageInfo(connection);
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
  const reviews = readReviews(asObject(pr.reviews));
  const threads = readThreads(asObject(pr.reviewThreads));

  return {
    ok: true,
    page: {
      number,
      headRefOid: headRefOid.toLowerCase(),
      mergeStateStatus,
      isDraft: pr.isDraft === true,
      rollupPresent: rollup !== null,
      rollupState: asString(rollup?.state),
      checks: checks.entries,
      checksHasNext: checks.hasNext,
      checksCursor: checks.cursor,
      reviews: reviews.entries,
      reviewsHasNext: reviews.hasNext,
      reviewsCursor: reviews.cursor,
      threads: threads.entries,
      threadsHasNext: threads.hasNext,
      threadsCursor: threads.cursor,
    },
  };
}

// ─── Severity read (predicate 4) ────────────────────────────────────────────

/**
 * HIGH/Major markers in a bot inline body, as the three bots actually write them:
 *   - GCA prints a priority IMAGE whose alt text is the level —
 *     `![high](https://www.gstatic.com/codereviewagent/high-priority.svg)`
 *     (observed on mmnto-ai/liquid-city#363, the checked-in positive capture);
 *   - CodeRabbit prints the severity WORD beside its emoji (`Critical`, `Major`);
 *   - greptile prints a `P0`/`P1` priority label.
 *
 * Deliberately WORD-based (no emoji code points in this source). The read is
 * broad on purpose: it errs toward blocking, and the audited override is the
 * documented way past a false positive. The FP direction — a body that merely
 * discusses "a major refactor" — is disclosed, not modelled away.
 */
/**
 * Word boundaries that also break on markdown emphasis. `\b` does NOT fire
 * between `_` and a letter — `_` is a word character — so a `\b`-anchored
 * marker misses CodeRabbit's `_Potential issue_` and `_🔴 Critical_` headings
 * entirely (found by the fold F9 fixture). These boundaries treat anything
 * outside [a-z0-9] as a separator, so emphasis, quotes and HTML attributes all
 * delimit the marker while a mid-token `GP1X` still does not match.
 */
const MARKER_BEFORE = '(?:^|[^a-z0-9])';
const MARKER_AFTER = '(?:[^a-z0-9]|$)';

const HIGH_SEVERITY_MARKERS: readonly RegExp[] = [
  /!\[(?:high|critical)\]/i,
  new RegExp(`${MARKER_BEFORE}critical${MARKER_AFTER}`, 'i'),
  new RegExp(`${MARKER_BEFORE}major${MARKER_AFTER}`, 'i'),
  new RegExp(`${MARKER_BEFORE}high[- ]severity${MARKER_AFTER}`, 'i'),
  new RegExp(`${MARKER_BEFORE}severity:\\s*high${MARKER_AFTER}`, 'i'),
  new RegExp(`${MARKER_BEFORE}p[01]${MARKER_AFTER}`, 'i'),
  // CodeRabbit's blocking class heads its comment with an emoji plus the words
  // "Potential issue", usually inside markdown emphasis — the words are read
  // here, the emoji is not (the prototype's marker, mmnto-ai/totem#2800 F9).
  new RegExp(`${MARKER_BEFORE}potential issue${MARKER_AFTER}`, 'i'),
];

/** Does this inline body carry a HIGH/Major severity marker? */
export function hasHighSeverityMarker(body: string): boolean {
  return HIGH_SEVERITY_MARKERS.some((re) => re.test(body));
}

// ─── Evidence helpers ───────────────────────────────────────────────────────

/** Bound and sanitize a fragment for a reason / provenance: no control characters, bounded length. */
function bounded(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
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
  checks: CheckEntry[];
  reviews: ReviewEntry[];
  threads: ThreadEntry[];
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
    checks: [],
    reviews: [],
    threads: [],
    pagesRead: 0,
    complete: false,
  };

  let checksDone = false;
  let reviewsDone = false;
  let threadsDone = false;
  let checksCursor: string | null = null;
  let reviewsCursor: string | null = null;
  let threadsCursor: string | null = null;

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

    if (checksDone && reviewsDone && threadsDone) {
      // R5's zero-checks FACT applies only when the rollup is consistent about
      // it: no rollup at all, or a rollup that reports success over an empty
      // context list. A rollup that says PENDING or FAILURE while classifying
      // zero contexts is an unreadable answer, never a green light
      // (mmnto-ai/totem#2800 fold F7).
      if (
        state.checks.length === 0 &&
        state.rollupState !== null &&
        state.rollupState !== 'SUCCESS'
      ) {
        return {
          ok: false,
          detail:
            'the status-check rollup reports ' +
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

function summarizeChecks(checks: readonly CheckEntry[]): {
  total: number;
  success: number;
  pending: number;
  failing: number;
} {
  let success = 0;
  let pending = 0;
  let failing = 0;
  for (const c of checks) {
    if (c.kind === 'success') success++;
    else if (c.kind === 'pending') pending++;
    else failing++;
  }
  return { total: checks.length, success, pending, failing };
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
 * HIGH/Major bot inlines that CURRENTLY apply to the head commit — thread
 * resolution deliberately IGNORED (ruled on mmnto-ai/totem#2800, fold F2).
 *
 * The comparison is `comment.commit.oid`, the commit the finding applies to
 * NOW (GitHub re-points it as the diff moves; it is the REST `commit_id` the
 * charter's predicate (c) names), never `originalCommit.oid`, the commit it was
 * written against — a predicate keyed on the write-time commit goes inert the
 * moment the branch advances, which is exactly the inert state this fold
 * removed.
 *
 * Predicate 4's distinct territory, the one predicate 2 cannot reach: a HIGH
 * finding a human RESOLVED by hand without changing the code. The comment still
 * applies to the head commit, so the floor still refuses the merge. Predicate 2
 * keeps its own rule (unresolved AND non-outdated, any severity) and still
 * fires first when both match.
 */
function highSeverityInlines(threads: readonly ThreadEntry[], headSha: string): ThreadEntry[] {
  return threads.filter(
    (t) =>
      t.rootLogin !== null &&
      isBotReviewerLoginExact(t.rootLogin) &&
      t.rootCommit !== null &&
      t.rootCommit.toLowerCase() === headSha &&
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
    checks: { total: 0, success: 0, pending: 0, failing: 0 },
    threads: { unresolvedBot: 0, pagesRead: 0, complete: false },
    changesRequestedBy: [],
    highInline: 0,
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
  detail.checks = summarizeChecks(state.checks);
  detail.threads = {
    unresolvedBot: unresolvedBotThreads(state.threads).length,
    pagesRead: state.pagesRead,
    complete: state.complete,
  };
  detail.changesRequestedBy = changesRequestedBy(state.reviews);
  detail.highInline = highSeverityInlines(state.threads, state.headSha).length;

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

  const blocked = firstFailure(state, detail);

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

/** The FIRST predicate that fails, in charter order, or null when the floor is met. */
function firstFailure(state: ReadState, detail: MergeReadyProvenanceDetail): Blocked | null {
  // 1. checks
  if (detail.checks.failing > 0) {
    const names = state.checks
      .filter((c) => c.kind === 'failing')
      .map((c) => c.name)
      .join(', ');
    return {
      predicate: 'checks',
      evidence: `${detail.checks.failing} of ${detail.checks.total} status checks are failing (${bounded(names)})`,
    };
  }
  if (detail.checks.pending > 0) {
    const names = state.checks
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

  // 4. HIGH/Major bot inline on the head commit
  const high = highSeverityInlines(state.threads, state.headSha);
  if (high.length > 0) {
    const first = high[0]!;
    return {
      predicate: 'high-severity-inline',
      evidence: `${high.length} HIGH/Major bot inline(s) still applying to the head commit — the first is ${first.rootLogin ?? 'a bot'}: "${bounded(first.rootBody)}"`,
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
