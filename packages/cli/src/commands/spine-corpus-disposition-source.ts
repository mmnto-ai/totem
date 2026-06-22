/**
 * #709 ground-truth deriver — slice 5d-ii: the live held-out disposition adapter.
 *
 * Fetches a HELD-OUT corpus PR's review threads WITH span anchoring (the comment
 * `diffHunk` + the thread line) — the data slice 5d-iii binds a `RuleFiring`'s
 * matched line to a disposition by content/invariant. Distinct from the mining
 * `ReviewThreadSourceAdapter` (which fetches TRAIN PRs and carries no span): the
 * answer key labels HELD-OUT firings, so it needs the held-out PRs' threads,
 * span-anchored, and a richer `CorpusDisposition` payload (core schema).
 *
 * Like the mining adapter, this SURFACES `isResolved`/`isOutdated` and never
 * filters on them (the #2201 "surface, don't filter" discipline; the taxonomy +
 * span-bind decide, 5d-i/5d-iii). Unlike it, a fetch failure FAILS LOUD: the
 * disposition freeze is a by-hand, all-or-nothing producer step (a silent skip
 * would under-populate the answer-key provenance), so a network/parse/pagination
 * fault throws a structured TotemError rather than a discriminated skip.
 *
 * CI HARD-GATE (agy panel): a live GitHub fetch must NEVER run in CI — the
 * certifying run is zero-network and reads only the FROZEN `corpus-dispositions.json`.
 * `fetch` throws if `CI` is set without an explicit `ALLOW_LIVE_FETCH` escape, so
 * an accidental test/CI invocation fails loud instead of hitting the network.
 *
 * Reuses the established `gh` CLI exec pattern (Tenet-21 — no bespoke GraphQL
 * client). The `exec` seam is injectable so the query-spy + mapping + CI-gate
 * tests run fully offline.
 */

import { z } from 'zod';

// Type-only import from '@mmnto/totem'; values are lazy-loaded in the exec seam.
import type { CorpusDisposition, CorpusDispositionThread } from '@mmnto/totem';

import type { GhExec } from './spine-review-thread-source.js';

// ─── Named constants ─────────────────────────────────

const GH_TIMEOUT_MS = 60_000;
const GH_MAX_BUFFER = 10 * 1024 * 1024;
/** Single page; a payload past one page fails LOUD rather than silently shrinking the provenance. */
const PAGE_SIZE = 100;

// ─── GraphQL response schema (Zod at the IO boundary only) ───────────────────

const PageInfoSchema = z.object({ hasNextPage: z.boolean() });

const GqlCommentSchema = z.object({
  // databaseId is the audit-anchor the evidence-ref points at (5d-iii). Nullable for system rows.
  databaseId: z.number().int().nullable(),
  // diffHunk is the content span the firing binds to; '' for an outdated/synthetic comment.
  diffHunk: z.string().nullable(),
  author: z.object({ login: z.string() }).nullable(),
  body: z.string(),
});

const GqlThreadSchema = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  path: z.string(),
  line: z.number().int().nullable(),
  originalLine: z.number().int().nullable(),
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
              nodes: z.array(GqlThreadSchema),
            }),
          })
          .nullable(),
      })
      .nullable(),
  }),
});

// ─── Query construction ──────────────────────────────

/**
 * Build the held-out `reviewThreads` GraphQL query. ADDITIVELY requests the span
 * anchors (`line`, `originalLine`, comment `diffHunk`) + the audit ids
 * (`thread.id`, comment `databaseId`) on top of the mining query's
 * `isResolved`/`isOutdated`/`path`/`author`/`body`. It deliberately does NOT add
 * an `isResolved: false` server filter (the "surface, don't filter" ruling).
 * Exported for the query-spy test.
 */
export function buildCorpusDispositionsQuery(owner: string, name: string, pr: number): string {
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
    pullRequest(number: ${pr}) {
      mergeCommit { oid }
      reviewThreads(first: ${PAGE_SIZE}) {
        pageInfo { hasNextPage }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first: ${PAGE_SIZE}) {
            pageInfo { hasNextPage }
            nodes {
              databaseId
              diffHunk
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

// ─── Mapping ─────────────────────────────────────────

/**
 * Map validated GraphQL thread nodes to `CorpusDispositionThread[]`. The thread's
 * span source `diffHunk` is the ROOT (first) comment's hunk — the finding's
 * anchor; a thread with no comments carries ''. A null author (deleted/ghost)
 * coerces to '' (a non-bot empty author core's logic handles). Pure — exported
 * for the mapping test.
 */
export function mapDispositionThreads(
  nodes: z.infer<typeof GqlThreadSchema>[],
): CorpusDispositionThread[] {
  return nodes.map((t) => ({
    threadId: t.id,
    path: t.path,
    line: t.line,
    originalLine: t.originalLine,
    // The root comment's hunk is the finding's span; '' when absent (outdated/empty thread).
    diffHunk: t.comments.nodes[0]?.diffHunk ?? '',
    isResolved: t.isResolved,
    isOutdated: t.isOutdated,
    comments: t.comments.nodes.map((c) => ({
      ...(c.databaseId !== null ? { commentId: c.databaseId } : {}),
      author: c.author?.login ?? '',
      body: c.body,
    })),
  }));
}

// ─── The adapter ─────────────────────────────────────

export interface CorpusDispositionSourceOptions {
  owner: string;
  name: string;
  cwd?: string;
  /** Injectable exec seam (tests). Defaults to a `gh`-backed `safeExec`. */
  exec?: GhExec;
  /** Process env (injected in tests) — the CI hard-gate reads it. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * The live held-out `corpus-dispositions` source. By-hand producer-time only
 * (never CI — the hard-gate enforces it). `fetch` throws loud on any fault.
 */
export class CorpusDispositionSourceAdapter {
  private readonly owner: string;
  private readonly name: string;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly injectedExec: GhExec | undefined;
  private execPromise: Promise<GhExec> | undefined;

  constructor(opts: CorpusDispositionSourceOptions) {
    this.owner = opts.owner;
    this.name = opts.name;
    this.cwd = opts.cwd ?? process.cwd();
    this.env = opts.env ?? process.env;
    this.injectedExec = opts.exec;
  }

  private async resolveExec(): Promise<GhExec> {
    if (this.injectedExec) return this.injectedExec;
    this.execPromise ??= (async () => {
      const { safeExec } = await import('@mmnto/totem');
      return (command: string, args: string[]) =>
        safeExec(command, args, {
          cwd: this.cwd,
          timeout: GH_TIMEOUT_MS,
          maxBuffer: GH_MAX_BUFFER,
          env: { ...process.env, GH_PROMPT_DISABLED: '1' },
        });
    })();
    return this.execPromise;
  }

  async fetch(pr: number): Promise<CorpusDisposition> {
    const { TotemError } = await import('@mmnto/totem');

    // CI hard-gate (agy): a live fetch in CI is a contract violation — the cert run
    // is zero-network and reads only the frozen fixture. Fail loud, never the network.
    if (this.env['CI'] && !this.env['ALLOW_LIVE_FETCH']) {
      throw new TotemError(
        'CONFIG_INVALID',
        'corpus-disposition fetch: live GitHub fetch attempted in a CI context.',
        'fetch-dispositions is a by-hand producer step; the cert run reads the frozen ' +
          'corpus-dispositions.json. Set ALLOW_LIVE_FETCH=1 only for a deliberate live freeze.',
      );
    }

    const query = buildCorpusDispositionsQuery(this.owner, this.name, pr);
    const exec = await this.resolveExec();

    let raw: string;
    try {
      raw = exec('gh', ['api', 'graphql', '-f', `query=${query}`]);
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `corpus-disposition fetch: gh graphql failed for held-out PR #${pr}.`,
        'Verify gh auth + repo access (the freeze is all-or-nothing — no silent skip).',
        err,
      );
    }

    let parsed: z.infer<typeof GqlResponseSchema>;
    try {
      parsed = GqlResponseSchema.parse(JSON.parse(raw));
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `corpus-disposition fetch: payload unparseable for held-out PR #${pr}.`,
        'The gh GraphQL response did not match the expected shape.',
        err,
      );
    }

    const repo = parsed.data.repository;
    if (!repo) {
      throw new TotemError(
        'CONFIG_INVALID',
        `corpus-disposition fetch: repository ${this.owner}/${this.name} not found or inaccessible (PR #${pr}).`,
        'Check owner/name + token scope.',
      );
    }
    const pull = repo.pullRequest;
    if (!pull) {
      throw new TotemError(
        'CONFIG_INVALID',
        `corpus-disposition fetch: held-out PR #${pr} not found in ${this.owner}/${this.name}.`,
        'Verify the split heldOut set matches the lc repo.',
      );
    }
    const mergeCommitSha = pull.mergeCommit?.oid?.toLowerCase();
    if (!mergeCommitSha) {
      throw new TotemError(
        'CONFIG_INVALID',
        `corpus-disposition fetch: held-out PR #${pr} has no merge commit oid.`,
        'A held-out corpus PR must be merged (lc is squash-merge).',
      );
    }

    // No-silent-shrink (§6): a paginated payload fails loud rather than freezing a
    // partial provenance set (the integrity digest must cover the COMPLETE threads).
    if (pull.reviewThreads.pageInfo.hasNextPage) {
      throw new TotemError(
        'CONFIG_INVALID',
        `corpus-disposition fetch: held-out PR #${pr} has more than ${PAGE_SIZE} review threads (pagination unsupported).`,
        'Increase PAGE_SIZE or add pagination (TODO #2199) before freezing this corpus.',
      );
    }
    for (const t of pull.reviewThreads.nodes) {
      if (t.comments.pageInfo.hasNextPage) {
        throw new TotemError(
          'CONFIG_INVALID',
          `corpus-disposition fetch: PR #${pr} thread ${t.id} has more than ${PAGE_SIZE} comments (pagination unsupported).`,
          'Increase PAGE_SIZE or add pagination before freezing this corpus.',
        );
      }
    }

    return { pr, mergeCommitSha, threads: mapDispositionThreads(pull.reviewThreads.nodes) };
  }
}
