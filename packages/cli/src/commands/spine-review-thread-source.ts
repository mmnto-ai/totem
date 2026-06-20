/**
 * ADR-111 Stage-1 Extract — the live CLI `ReviewThreadSource` adapter (slice 5a,
 * mmnto-ai/totem#2201).
 *
 * Core defines the `ReviewThreadSource` port and stays network-free + LLM-free +
 * deterministic; THIS file is the IO-at-the-edge implementation that wraps the
 * GitHub GraphQL `reviewThreads` API behind that port. It fetches a PR's merge
 * commit + its review threads (each carrying `isResolved` / `isOutdated`), maps
 * them to the provider-neutral `ReviewThreadContent`, and SURFACES the per-thread
 * resolution flags to core. It does NOT filter resolved/outdated threads — the
 * contract-owner ruling is "surface, don't filter": core decides eligibility and
 * drop-ledgers every rejection (§8 "every rejection ledgered"). A server-side or
 * client-side `isResolved:false` pre-filter is FORBIDDEN here.
 *
 * Error contract (the discriminated `FetchResult`, §6): a per-PR failure is NEVER
 * thrown — the orchestrator iterates the whole train slice and must not abort on
 * one bad PR. Network / not-found → `{kind:'unreachable'}`; a malformed or
 * unmappable payload → `{kind:'unparseable'}`. The mining run continues; the loud
 * drop is core's job.
 *
 * Reuses the established `gh` CLI exec pattern (Tenet-21 — no bespoke GraphQL
 * client). The `exec` seam is injectable so the query-spy + mapping tests run
 * fully offline (no network, CI-locked).
 */

import { z } from 'zod';

// Value imports from '@mmnto/totem' are lazy-loaded inside the exec seam (below)
// to keep CLI startup fast — the core barrel pulls in heavy deps (LanceDB,
// apache-arrow). Matches the spine-windtunnel.ts convention. Type-only imports
// are erased at compile, so they stay static.
import type { FetchResult, ReviewThread, ReviewThreadSource } from '@mmnto/totem';

// ─── Named constants ─────────────────────────────────

/** gh exec timeout (ms). */
const GH_TIMEOUT_MS = 60_000;
/** 10MB — handles large review-thread payloads without ENOBUFS. */
const GH_MAX_BUFFER = 10 * 1024 * 1024;
/**
 * Page size for `reviewThreads(first:)` / `comments(first:)`. A single page is
 * fetched; if GitHub reports more, the adapter fails LOUD (`unparseable`) rather
 * than silently truncating the corpus (§6 no-silent-shrink). The Gate-1 corpus
 * PRs are small reviewed PRs, comfortably within one page.
 *
 * TODO(#2199): paginate reviewThreads/comments past one page if a future corpus
 * PR ever exceeds PAGE_SIZE.
 */
const PAGE_SIZE = 100;

// ─── GraphQL response schema (Zod at the IO boundary only) ───────────────────

const PageInfoSchema = z.object({ hasNextPage: z.boolean() });

const GqlCommentSchema = z.object({
  // `author` is null for deleted/ghost accounts — coerce downstream to ''.
  author: z.object({ login: z.string() }).nullable(),
  body: z.string(),
});

const GqlReviewThreadSchema = z.object({
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  comments: z.object({
    pageInfo: PageInfoSchema,
    nodes: z.array(GqlCommentSchema),
  }),
});

const GqlResponseSchema = z.object({
  data: z.object({
    repository: z
      .object({
        pullRequest: z
          .object({
            mergeCommit: z.object({ oid: z.string() }).nullable(),
            reviewThreads: z.object({
              pageInfo: PageInfoSchema,
              nodes: z.array(GqlReviewThreadSchema),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

// ─── Query construction (structurally requests isResolved + isOutdated) ──────

/**
 * Build the `reviewThreads` GraphQL query. It REQUESTS `isResolved` and
 * `isOutdated` per thread (so core HAS the signal to decide on) — it deliberately
 * does NOT add an `isResolved: false` server-side filter (the "surface, don't
 * filter" ruling; the query-spy test asserts both halves). Exported for the
 * query-spy test.
 */
export function buildReviewThreadsQuery(owner: string, name: string, pr: number): string {
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${pr}) {
      mergeCommit { oid }
      reviewThreads(first: ${PAGE_SIZE}) {
        pageInfo { hasNextPage }
        nodes {
          isResolved
          isOutdated
          path
          comments(first: ${PAGE_SIZE}) {
            pageInfo { hasNextPage }
            nodes {
              author { login }
              body
            }
          }
        }
      }
    }
  }
}`;
}

// ─── The exec seam ───────────────────────────────────

/**
 * The injectable command-exec seam. Matches the relevant part of `safeExec`'s
 * signature; the tests pass a fake that intercepts the outgoing GraphQL query
 * (no network). When not injected, the adapter lazy-loads `safeExec` (below).
 */
export type GhExec = (command: string, args: string[]) => string;

/**
 * Lazy-load `safeExec` and bind it to a `gh`-backed `GhExec` for `cwd`. The
 * dynamic import keeps the heavy core barrel off the CLI startup path (the
 * spine-windtunnel.ts convention).
 */
async function loadDefaultExec(cwd: string): Promise<GhExec> {
  const { safeExec } = await import('@mmnto/totem');
  return (command, args) =>
    safeExec(command, args, {
      cwd,
      timeout: GH_TIMEOUT_MS,
      maxBuffer: GH_MAX_BUFFER,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
}

// ─── Mapping ─────────────────────────────────────────

/**
 * Map a validated GraphQL response to the surviving `ReviewThread[]` with their
 * resolution flags surfaced. Pure — exported for the mapping test. A null author
 * (deleted/ghost) coerces to '' (`isBotIdentity('')` is false, so it stays a
 * human-author '' that core's empty-body / count logic handles correctly; the
 * body still gates inclusion).
 */
export function mapThreads(nodes: z.infer<typeof GqlReviewThreadSchema>[]): ReviewThread[] {
  return nodes.map((t) => ({
    path: t.path,
    // SURFACE the flags — never filter on them here (core decides).
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    comments: t.comments.nodes.map((c) => ({
      author: c.author?.login ?? '',
      body: c.body,
    })),
  }));
}

// ─── The adapter ─────────────────────────────────────

export interface ReviewThreadSourceAdapterOptions {
  /** The repo to query, as `owner` + `name`. */
  owner: string;
  name: string;
  /** Working directory for the `gh` invocation (real adapter). */
  cwd?: string;
  /** Injectable exec seam (tests). Defaults to a `gh`-backed `safeExec`. */
  exec?: GhExec;
}

/**
 * The live `ReviewThreadSource`. Constructible + exported now (slice 5a); wiring
 * it into the spine orchestrator's `run` command is slice 5c.
 */
export class ReviewThreadSourceAdapter implements ReviewThreadSource {
  private readonly owner: string;
  private readonly name: string;
  private readonly cwd: string;
  /** Injected exec seam (tests); when absent the default is lazy-loaded once via `execPromise`. */
  private readonly injectedExec: GhExec | undefined;
  /**
   * Memoized lazy-load of the default `gh`-backed exec (real runs). Memoizes the
   * PROMISE, not the resolved value, so concurrent `fetch()` calls on one adapter
   * instance share a single `loadDefaultExec` instead of racing a `!this.exec`
   * guard (CR #2207 — was benign since dynamic import is idempotent, now explicit).
   */
  private execPromise: Promise<GhExec> | undefined;

  constructor(opts: ReviewThreadSourceAdapterOptions) {
    this.owner = opts.owner;
    this.name = opts.name;
    this.cwd = opts.cwd ?? process.cwd();
    this.injectedExec = opts.exec;
  }

  /** Resolve the exec seam: the injected one (tests), else the memoized lazy-loaded default. */
  private resolveExec(): Promise<GhExec> {
    if (this.injectedExec) return Promise.resolve(this.injectedExec);
    this.execPromise ??= loadDefaultExec(this.cwd);
    return this.execPromise;
  }

  async fetch(pr: number): Promise<FetchResult> {
    const query = buildReviewThreadsQuery(this.owner, this.name, pr);
    const exec = await this.resolveExec();

    // totem-context: this catch does NOT silently degrade — it is the §6 port
    // contract. A per-PR IO failure (network/404/auth) is reified into the
    // discriminated FetchResult ('unreachable') and surfaced LOUDLY to core,
    // which drop-ledgers it (a creditable FM-i drop). Re-throwing would abort the
    // whole mining run on one bad PR, violating the orchestrator's train-slice
    // sweep. The loud-fail lives in core's ledger, not a thrown exception.
    let raw: string;
    try {
      raw = exec('gh', ['api', 'graphql', '-f', `query=${query}`]);
      // totem-context: intentional §6 port contract — reify IO failure into the discriminated FetchResult, surfaced loudly to core's drop ledger; never swallowed.
    } catch (err) {
      return {
        kind: 'unreachable',
        detail: `gh graphql fetch failed for PR #${pr}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // totem-context: intentional — same §6 port contract as above. A malformed /
    // unmappable payload is reified into FetchResult ('unparseable', a route
    // distinct from 'unreachable') and surfaced LOUDLY to core for drop-ledgering,
    // not swallowed. Re-throwing would abort the orchestrator's whole train-slice
    // sweep on one bad payload.
    let parsed: z.infer<typeof GqlResponseSchema>;
    try {
      parsed = GqlResponseSchema.parse(JSON.parse(raw));
      // totem-context: intentional §6 port contract — reify the unparseable payload into the discriminated FetchResult, surfaced loudly to core's drop ledger; never swallowed.
    } catch (err) {
      return {
        kind: 'unparseable',
        detail: `review-thread payload unparseable for PR #${pr}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Distinguish a null repository (repo inaccessible / token lacks scope) from a
    // null pullRequest (PR genuinely not found): both are `unreachable`, but they
    // need different diagnostic leads, so the detail strings differ (CR + Greptile
    // #2207 — a shared `!pull` guard would send a token-scope failure chasing a
    // non-existent PR).
    const repo = parsed.data.repository;
    if (!repo) {
      return {
        kind: 'unreachable',
        detail: `repository ${this.owner}/${this.name} not found or inaccessible (check owner/name + token scope) while fetching PR #${pr}`,
      };
    }
    const pull = repo.pullRequest;
    if (!pull) {
      return { kind: 'unreachable', detail: `PR #${pr} not found in ${this.owner}/${this.name}` };
    }

    // A merged train PR MUST have a merge commit (the provenance SHA core needs).
    // Its absence is an unusable payload, not a fetch failure → 'unparseable'.
    const mergeCommitSha = pull.mergeCommit?.oid?.toLowerCase();
    if (!mergeCommitSha) {
      return { kind: 'unparseable', detail: `PR #${pr} has no merge commit oid` };
    }

    // No-silent-shrink (§6): if the payload was paginated past one page, fail
    // LOUD rather than mining a partial thread set.
    if (pull.reviewThreads.pageInfo.hasNextPage) {
      return {
        kind: 'unparseable',
        detail: `PR #${pr} has more than ${PAGE_SIZE} review threads (pagination unsupported)`,
      };
    }
    for (const t of pull.reviewThreads.nodes) {
      if (t.comments.pageInfo.hasNextPage) {
        return {
          kind: 'unparseable',
          detail: `PR #${pr} has a review thread with more than ${PAGE_SIZE} comments (pagination unsupported)`,
        };
      }
    }

    const threads = mapThreads(pull.reviewThreads.nodes);
    return {
      kind: 'ok',
      content: { pr, mergeCommitSha, threads },
    };
  }
}
