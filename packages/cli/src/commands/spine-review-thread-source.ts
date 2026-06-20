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

import type { FetchResult, ReviewThread, ReviewThreadSource } from '@mmnto/totem';
import { safeExec } from '@mmnto/totem';

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
 * (no network). Defaults to the real `gh` invocation.
 */
export type GhExec = (command: string, args: string[]) => string;

function defaultExec(cwd: string): GhExec {
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
  private readonly exec: GhExec;

  constructor(opts: ReviewThreadSourceAdapterOptions) {
    this.owner = opts.owner;
    this.name = opts.name;
    this.exec = opts.exec ?? defaultExec(opts.cwd ?? process.cwd());
  }

  async fetch(pr: number): Promise<FetchResult> {
    const query = buildReviewThreadsQuery(this.owner, this.name, pr);

    // IO: network / not-found / auth failures are 'unreachable' (never fetched a
    // usable payload). NOT thrown — the orchestrator must not abort on one PR.
    let raw: string;
    try {
      raw = this.exec('gh', ['api', 'graphql', '-f', `query=${query}`]);
    } catch (err) {
      return {
        kind: 'unreachable',
        detail: `gh graphql fetch failed for PR #${pr}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Parse + validate: a malformed / unmappable payload is 'unparseable' (fetched
    // but unusable — a distinct route from 'unreachable', §6).
    let parsed: z.infer<typeof GqlResponseSchema>;
    try {
      parsed = GqlResponseSchema.parse(JSON.parse(raw));
    } catch (err) {
      return {
        kind: 'unparseable',
        detail: `review-thread payload unparseable for PR #${pr}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const repo = parsed.data.repository;
    const pull = repo?.pullRequest;
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
        detail: `PR #${pr} has more than ${PAGE_SIZE} review threads (pagination unsupported in slice 5a)`,
      };
    }
    for (const t of pull.reviewThreads.nodes) {
      if (t.comments.pageInfo.hasNextPage) {
        return {
          kind: 'unparseable',
          detail: `PR #${pr} has a review thread with more than ${PAGE_SIZE} comments (pagination unsupported in slice 5a)`,
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
