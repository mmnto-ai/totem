import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ContentType, HealthCheckResult, SearchResult } from '@mmnto/totem';
import { ContentTypeSchema } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';
import { logMcpCall } from '../ledger-writer.js';
import { logSearch, setLogDir } from '../search-log.js';
import { extractIndexState } from '../state-extractors.js';
import { formatIndexEnvelope, formatSystemWarning, formatXmlResponse } from '../xml-format.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/**
 * Per-query runtime failure log (mmnto/totem#1295). Primary failures are
 * tracked in a dedicated slot, NOT in the linked-store map, because
 * `'primary'` is a legal link name — `deriveLinkName` strips leading dots,
 * so a linked repo at `.primary/` would derive to `'primary'` and collide
 * with the reserved key. Keeping primary in its own field eliminates the
 * collision class entirely. (CR MAJOR catch on round 7.)
 */
interface FailureLog {
  primary: string | null;
  linked: Map<string, string>;
}

function makeFailureLog(): FailureLog {
  return { primary: null, linked: new Map() };
}

function failureLogIsEmpty(log: FailureLog): boolean {
  return log.primary === null && log.linked.size === 0;
}

const MAX_SEARCH_RESULTS = 100;

/** Session-level flag — healthCheck runs only on the first search call. */
let firstHealthCheckDone = false;
/** Session-level flag — linkedStoreInitErrors surface only on the first search call. */
let firstLinkedStoresCheckDone = false;

/**
 * Reset both session flags. Test-only export — production code should never
 * call this. Allows test suites to exercise the first-query behaviors
 * repeatedly across individual test cases.
 */
export function _resetSessionFlags(): void {
  firstHealthCheckDone = false;
  firstLinkedStoresCheckDone = false;
}

/**
 * Run a one-time check on linked-store initialization errors (mmnto/totem#1294
 * Phase 2). Returns a formatted system warning listing every linked index
 * that failed to initialize, or null when none failed / after the first call.
 *
 * This is INTENTIONALLY non-blocking — unlike `runFirstQueryHealthCheck`,
 * which treats a dimension mismatch as fatal, linked-store failures are
 * always recoverable by degrading to primary-only search. The warning is
 * surfaced so the agent sees it in-context, but the server continues to
 * serve every subsequent search from whatever stores did initialize.
 */
async function runFirstLinkedStoresCheck(): Promise<string | null> {
  if (firstLinkedStoresCheckDone) return null;

  try {
    const { linkedStoreInitErrors } = await getContext();
    // mmnto/totem#1295 CR minor: only consume the one-shot flag AFTER
    // getContext resolves successfully. Setting it before the await meant
    // a transient init failure on the first call would permanently
    // suppress the startup warning for the rest of the session.
    firstLinkedStoresCheckDone = true;
    if (linkedStoreInitErrors.size === 0) return null;

    // mmnto/totem#1295 CR minor: `linkedStoreInitErrors` now holds BOTH
    // fatal init failures AND non-fatal startup warnings (e.g., empty
    // linked stores, name collisions where the first link still loaded).
    // Use neutral wording so the summary line accurately covers both.
    const lines: string[] = [
      `Cross-Repo Context Mesh: ${linkedStoreInitErrors.size} linked index startup issue(s).`,
      '',
      'Federated search will proceed using only the stores that initialized successfully. Review the issues below so cross-repo queries return complete context. (mmnto/totem#1294)',
      '',
    ];
    for (const [name, err] of linkedStoreInitErrors.entries()) {
      lines.push(`  - ${name}: ${err}`);
    }
    return formatSystemWarning(lines.join('\n'));
  } catch (err) {
    // Meta-failure: getContext() itself threw. Log and return null — the
    // outer runFirstQueryHealthCheck will surface that failure via its own
    // path, so there's no value in double-reporting here.
    logSearch({
      timestamp: new Date().toISOString(),
      query: 'internal:linked-stores-check',
      resultCount: 0,
      durationMs: 0,
      topScore: null,
      error: `Linked stores check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}

/**
 * Run a one-time health check on the LanceDB index and return any warnings.
 * Returns null when healthy or after the first call (cached).
 */
async function runFirstQueryHealthCheck(): Promise<string | null> {
  if (firstHealthCheckDone) return null;

  try {
    const { store } = await getContext();
    const result: HealthCheckResult = await store.healthCheck();

    // Healthy — consume the one-shot flag and skip the warning for this
    // session. This is the common case.
    if (result.healthy) {
      firstHealthCheckDone = true;
      return null;
    }

    // mmnto/totem#1295 CR MAJOR: dimension mismatch must KEEP firing on
    // every query until the user actually fixes the index. Consuming the
    // flag here would let query 2 onwards skip the gate and fall back to
    // the cryptic LanceDB "vector dimension mismatch" error — exactly
    // what the friendly diagnostic exists to prevent. The outer
    // `registerSearchKnowledge` blocks the search with isError: true
    // whenever this branch returns a warning, so a persistent mismatch
    // produces a persistent actionable message rather than a one-shot
    // reminder followed by silent cryptic failures.
    if (!result.dimensionMatch && result.storedDimensions !== null) {
      const lines = [
        `DIMENSION MISMATCH: Index has ${result.storedDimensions}-dim vectors but the configured embedder produces ${result.expectedDimensions}-dim vectors.`,
        '',
        'This usually means you switched embedding providers without rebuilding the index.',
        'Fix: rm -rf .lancedb && totem sync --full',
        '',
        'If you already rebuilt, restart your AI agent to reload the MCP server with the new config.',
      ];
      return formatSystemWarning(lines.join('\n'));
    }

    // Non-fatal health warnings (stale rows, missing partitions, etc.):
    // search still returns results — the warning is informational, not
    // blocking — so one-shot consumption is appropriate here.
    firstHealthCheckDone = true;
    const lines: string[] = ['Index health issues detected:'];
    for (const issue of result.issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
    lines.push('Run `totem sync --full` to re-index and fix these issues.');

    return formatSystemWarning(lines.join('\n'));
  } catch (err) {
    // Health check itself failed — don't block the search. Log to disk for debugging.
    logSearch({
      timestamp: new Date().toISOString(),
      query: 'internal:health-check',
      resultCount: 0,
      durationMs: 0,
      topScore: null,
      error: `Health check failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}

/**
 * Format a single search result for display. Linked-store results (sourceRepo
 * set) get a `[<sourceRepo>]` prefix on the label and the absolute path as
 * the File field, so the agent can route file-reading tools without having
 * to reason about which repo owns the result. Primary results (sourceRepo
 * undefined) use the compact relative-path form for readability.
 *
 * mmnto/totem#1294 Phase 2.
 */
function formatResult(r: SearchResult, index: number): string {
  // Build the header line in two halves so the `[tag] label` segment is
  // joined with explicit `+` rather than two adjacent template placeholders
  // (which the concat-without-delimiter lint rule flags).
  const labelWithTag = r.sourceRepo ? `[${r.sourceRepo}] ` + r.label : r.label;
  // mmnto-ai/totem#2463: surface the true relevance signal alongside the
  // ordering `score`. `score` stays (RRF rank artifact — drives display order);
  // `relevance` is the vector-leg similarity, or an explicit keyword-match note
  // when the hit had no vector leg (FTS-only), so the agent never mistakes an
  // absent signal for a low one.
  const relevanceField =
    typeof r.relevance === 'number' ? r.relevance.toFixed(3) : 'n/a (keyword match)';
  // mmnto/totem#1295 CR MAJOR: ALWAYS display the absolute path. The whole
  // point of `absoluteFilePath` on `SearchResult` is to give agents an
  // unambiguous Read/Edit target. Falling back to the relative `filePath`
  // for primary hits reintroduced repo-root ambiguity in the common case —
  // exactly the bug that field was added to fix.
  return (
    `### ${index + 1}. ${labelWithTag} (${r.type})\n` +
    `**File:** ${r.absoluteFilePath} | **Score:** ${r.score.toFixed(3)} | **Relevance:** ${relevanceField}\n\n` +
    r.content
  );
}

/**
 * Run federated search across primary + all linked stores in parallel.
 * Each store fetches up to `perStoreLimit` results; the combined pool is
 * then re-sorted by score and truncated to `finalLimit`.
 *
 * Mirrors the semantic-merge pattern established in
 * `packages/cli/src/commands/spec.ts:retrieveContext` — fetch per-store
 * budgets, concat, re-rank by score, truncate.
 *
 * **Runtime failure handling (mmnto/totem#1295 rewrite):** On a linked-
 * store search error, attempt a targeted `reconnect()` + retry. If the
 * retry succeeds, return the fresh results. If it fails, record the
 * failure into the caller-provided `failures` log and return empty for
 * that store on THIS query only. Primary failures go in `failures.primary`
 * (a dedicated slot — `'primary'` would collide with a legal link name);
 * linked failures go in `failures.linked` keyed by link name.
 *
 * This function DOES NOT mutate the global `linkedStores` or
 * `linkedStoreInitErrors` maps — an earlier revision evicted failing
 * stores to avoid log spam, but GCA + CR both flagged that as a Tenet 4
 * violation: transient errors (file locks during parallel sync, network
 * blips) caused permanent context loss until server restart. The correct
 * tradeoff is to accept some log spam for resilience, and surface
 * runtime failures via the per-request warning path (see `performSearch`).
 *
 * mmnto/totem#1294 Phase 2 + mmnto/totem#1295 fix.
 */
async function federatedSearch(
  query: string,
  typeFilter: ContentType | undefined,
  perStoreLimit: number,
  finalLimit: number,
  failures: FailureLog,
): Promise<SearchResult[]> {
  const { store: primaryStore, linkedStores } = await getContext();

  // mmnto/totem#1295 GCA HIGH: catch primary failures inside federatedSearch
  // ONLY when linked stores exist, so a transient primary failure doesn't
  // kill linked-store results. For non-mesh users (no linked stores), let
  // primary failures bubble to the outer reconnect+retry in
  // `registerSearchKnowledge` — that path produces a hard error which is
  // strictly more useful than "empty results + warning" when primary is
  // the only target. The outer path also still handles raw-prefix cases
  // (Cases 1, 4) where primary is the only target regardless of mesh state.
  //
  // When the inner catch fires, primary uses the SAME targeted reconnect+
  // retry pattern as linked stores below: catch → reconnect → retry → on
  // second failure, log and record into `failures.primary`. Promise.all
  // never rejects from the primary slot.
  const hasLinkedStores = linkedStores.size > 0;
  const primaryPromise = hasLinkedStores
    ? primaryStore
        .search({ query, typeFilter, maxResults: perStoreLimit, allowFtsFallback: true })
        .catch(async (err: unknown) => {
          const firstMsg = err instanceof Error ? err.message : String(err);
          try {
            await primaryStore.reconnect();
            return await primaryStore.search({
              query,
              typeFilter,
              maxResults: perStoreLimit,
              allowFtsFallback: true,
            });
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            const combinedMsg = `search failed (initial: ${firstMsg}; reconnect+retry: ${retryMsg})`;
            logSearch({
              timestamp: new Date().toISOString(),
              query: 'internal:primary-store-search',
              resultCount: 0,
              durationMs: 0,
              topScore: null,
              error: `Primary store ${combinedMsg}`,
            });
            failures.primary = combinedMsg;
            return [] as SearchResult[];
          }
        })
    : primaryStore.search({ query, typeFilter, maxResults: perStoreLimit, allowFtsFallback: true });

  // Linked stores: catch per-store failures so one broken linked index
  // doesn't break the overall query. On failure, attempt targeted
  // reconnect + retry, then return empty for this query (populating
  // `failures.linked` for the caller to surface). Global state is NEVER
  // mutated here — the store stays in `linkedStores` so the next query
  // can try again (the transient issue may have cleared).
  const linkedPromises = Array.from(linkedStores.entries()).map(([name, ls]) =>
    ls
      .search({ query, typeFilter, maxResults: perStoreLimit, allowFtsFallback: true })
      .catch(async (err) => {
        const firstMsg = err instanceof Error ? err.message : String(err);
        try {
          await ls.reconnect();
          return await ls.search({
            query,
            typeFilter,
            maxResults: perStoreLimit,
            allowFtsFallback: true,
          });
          // totem-context: mmnto-ai/totem#1295 — the catch below is not a silent swallow; the failure is recorded in `failures.linked` and surfaced to the agent as a per-query system warning.
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const combinedMsg = `search failed (initial: ${firstMsg}; reconnect+retry: ${retryMsg})`;
          logSearch({
            timestamp: new Date().toISOString(),
            query: `internal:linked-store-search:${name}`,
            resultCount: 0,
            durationMs: 0,
            topScore: null,
            error: `Linked store "${name}" ${combinedMsg}`,
          });
          failures.linked.set(name, combinedMsg);
          return [] as SearchResult[];
        }
      }),
  );

  const [primaryResults, ...linkedResults] = await Promise.all([primaryPromise, ...linkedPromises]);
  const buckets: SearchResult[][] = [primaryResults, ...linkedResults];

  // Single-bucket fast path (no linked stores configured): scores are
  // already comparable since they all come from one store. Skip RRF
  // normalization to keep the original scores visible to the agent.
  if (buckets.length === 1) {
    return primaryResults.slice(0, finalLimit);
  }

  // mmnto/totem#1295 GCA CRITICAL: re-rank via Reciprocal Rank Fusion
  // across stores. `LanceStore.search` returns scores in incompatible
  // scales depending on the search method:
  //
  //   - Hybrid (default): RRF scores ~0.01–0.04
  //   - Vector-only (no FTS): 1/(1+distance) ~0.5–0.95
  //   - FTS-only: raw _score, often > 1
  //
  // Sorting by raw scores would bias the merge toward whichever store
  // happens to use the larger-scale scoring method. RRF fixes this: each
  // store's results are treated as a ranked list and a new score is
  // assigned based on rank-within-store. The visible `score` field is
  // OVERWRITTEN with the RRF score so the displayed order matches the
  // displayed score (avoids the "ranked first but lower number" UX
  // confusion). Within-store relative ordering is preserved.
  //
  // RRF k=60 matches the constant used inside `LanceStore.rrfMerge` for
  // intra-store hybrid fusion, for consistency.
  //
  // mmnto-ai/totem#2463: the `{ ...r }` spread carries each hit's `relevance`
  // and `searchMethod` through untouched — this second fusion site overwrites
  // ONLY `score`, exactly as the intra-store `rrfMerge` does, so the true
  // relevance signal survives federation just as it survives single-store mode.
  const RRF_K_FEDERATION = 60;
  const reranked: SearchResult[] = [];
  for (const bucket of buckets) {
    bucket.forEach((r, rank) => {
      reranked.push({ ...r, score: 1 / (RRF_K_FEDERATION + rank + 1) });
    });
  }
  reranked.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return reranked.slice(0, finalLimit);
}

/**
 * Which retrieval path the returned hits came from, for the envelope's
 * `method` attribute (mmnto-ai/totem#2463). Any fts-stamped hit means a store
 * degraded to keyword-only, so `fts` is reported to keep the envelope method in
 * lockstep with the loud fallback warning. All hits vector-only → `vector`;
 * otherwise (default / mixed / empty) → `hybrid`.
 */
function deriveSearchMethod(results: SearchResult[]): 'hybrid' | 'vector' | 'fts' {
  if (results.some((r) => r.searchMethod === 'fts')) return 'fts';
  if (results.length > 0 && results.every((r) => r.searchMethod === 'vector')) return 'vector';
  return 'hybrid';
}

/**
 * Machine-parsable retrieval outcome line (mmnto-ai/totem#2463). Sits directly
 * below the `<index-meta>` line and shares its self-closing XML-attribute shape
 * so a wrapper agent can read the whole outcome with one regex. Every attribute
 * value is a closed enum or a formatted number — no user input — so no XML
 * escaping is required.
 */
export function formatRetrievalEnvelope(params: {
  status: 'ok' | 'no_useful_hits' | 'empty';
  method: 'hybrid' | 'vector' | 'fts';
  bestRelevance: number | null;
  floor: number;
  hits: number;
}): string {
  const best = params.bestRelevance !== null ? params.bestRelevance.toFixed(3) : 'n/a';
  return (
    `<retrieval-envelope status="${params.status}" method="${params.method}" ` +
    `bestRelevance="${best}" floor="${params.floor.toFixed(3)}" hits="${params.hits}" />`
  );
}

async function performSearch(
  query: string,
  typeFilter?: ContentType,
  maxResults?: number,
  boundary?: string,
  minRelevance?: number,
): Promise<ToolResult> {
  const { config, linkedStores, linkedStoreInitErrors, projectRoot } = await getContext();
  const finalLimit = maxResults ?? 5;

  // Knowledge-index freshness envelope (mmnto-ai/totem#2029 — docs-drift Mech C).
  // Computed per-call from cache/index-meta.json so consumers see staleness
  // inline with retrieval. STALE prefix (>7 days) escalates to a system
  // warning prepended above the envelope; populated/no-index envelope always
  // prepends so callers can route on freshness without guessing.
  const indexState = extractIndexState(projectRoot, config.totemDir);
  const indexEnvelope = formatIndexEnvelope(indexState);
  const staleWarning =
    indexState.staleness?.startsWith('STALE:') === true
      ? formatSystemWarning(
          `Knowledge index has not synced recently (${indexState.staleness}). ` +
            'Search results may not reflect on-disk state. Consider running `totem sync` before trusting these results.',
        )
      : null;

  // Per-query runtime failure log (mmnto/totem#1295). Populated by
  // `federatedSearch` when primary or any linked store errors during this
  // specific query. Surfaced as a compact system warning on the response
  // so the agent sees the failure in-context — NOT gated by any session-
  // level "already warned" flag. Every query where a store fails produces
  // its own warning; this is the correct Tenet 4 tradeoff versus the
  // earlier one-shot snapshot approach.
  //
  // Primary lives in `failures.primary` (a dedicated slot, NOT keyed under
  // `'primary'` in a map) because `'primary'` is a legal link name —
  // `deriveLinkName` strips leading dots so a `.primary/` linked repo would
  // collide with a reserved key. CR MAJOR catch on round 7.
  const failures: FailureLog = makeFailureLog();

  // ─── Boundary resolution (mmnto/totem#1294 Phase 2) ──
  //
  // Order of precedence:
  //   1. Local partition name (config.partitions[boundary]) → primary only, prefix filter
  //   2. Linked store name (linkedStores has key === boundary) → route ONLY to that linked store
  //   3. Broken linked store name (linkedStoreInitErrors has key === boundary) → explicit error
  //   4. Raw prefix string → primary only, prefix filter (today's fallback)
  //   5. Undefined → federated across primary + ALL linked stores
  //
  // Partition names win over linked-store names on collision. Users who
  // want to query a linked store whose name collides with a local
  // partition can rename the linked directory.
  //
  // Case 3 exists to prevent a silent-fallback drift bug (Tenet 4): if a
  // linked store previously existed but failed to reconnect, falling
  // through to the raw-prefix branch would query the primary store using
  // the broken link's name as a path prefix and return unrelated primary
  // hits. The agent would think it's querying the linked repo but get
  // local results — exactly the "silent drift" pattern Tenet 4 forbids.
  // Shield AI catch on mmnto/totem#1294 Phase 2 review.
  let results: SearchResult[];
  if (boundary !== undefined && config.partitions?.[boundary]) {
    // Case 1: local partition — primary only, prefix filter
    const { store: primaryStore } = await getContext();
    results = await primaryStore.search({
      query,
      typeFilter,
      maxResults: finalLimit,
      boundary: config.partitions[boundary],
      allowFtsFallback: true,
    });
  } else if (boundary !== undefined && linkedStores.has(boundary)) {
    // Case 2: linked store name — route ONLY to that linked store.
    //
    // Complete failure of an explicitly-targeted linked store (initial
    // search throws AND reconnect+retry also throws) returns isError: true
    // for symmetry with Case 3 (mmnto/totem#1295 GCA HIGH). When the
    // user explicitly names a boundary, "no results" and "the boundary
    // is broken" are very different signals — falling through to a
    // generic "no results" response would let the agent misinterpret a
    // real outage as an absence of relevant knowledge.
    const linked = linkedStores.get(boundary)!;
    try {
      results = await linked.search({
        query,
        typeFilter,
        maxResults: finalLimit,
        allowFtsFallback: true,
      });
      // totem-context: mmnto-ai/totem#1295 — the catch below is not a silent swallow; a fully-failed targeted boundary (initial AND reconnect+retry throw) is surfaced to the agent as an isError ToolResult.
    } catch (err) {
      const firstMsg = err instanceof Error ? err.message : String(err);
      try {
        await linked.reconnect();
        results = await linked.search({
          query,
          typeFilter,
          maxResults: finalLimit,
          allowFtsFallback: true,
        });
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        const errorText = formatSystemWarning(
          [
            `Linked-store search: targeted index "${boundary}" failed.`,
            '',
            `  Initial error:        ${firstMsg}`,
            `  Reconnect+retry error: ${retryMsg}`,
            '',
            `Cross-repo search for this boundary cannot proceed on this query. The store may recover on a subsequent call if the failure was transient (stale handle, file lock). mmnto/totem#1294.`,
          ].join('\n'),
        );
        return {
          content: [{ type: 'text' as const, text: errorText }], // totem-ignore #1294 — system-generated + XML-wrapped
          isError: true,
        };
      }
    }
  } else if (boundary !== undefined && linkedStoreInitErrors.has(boundary)) {
    // Case 3: explicitly-named linked store is in the failure map. Surface
    // the specific error rather than silently degrading to raw-prefix
    // search on the primary (which would return bogus hits from the
    // primary repo under the link's name as a prefix).
    const errMsg = linkedStoreInitErrors.get(boundary);
    const warning = formatSystemWarning(
      [
        `Linked index "${boundary}" is not available: ${errMsg ?? 'unknown error'}`,
        '',
        `Cross-repo search for this boundary cannot proceed. Fix the linked index and restart the MCP server (mmnto/totem#1294).`,
      ].join('\n'),
    );
    return {
      content: [{ type: 'text' as const, text: warning }], // totem-ignore #1294 — system-generated + XML-wrapped
      isError: true,
    };
  } else if (boundary !== undefined) {
    // Case 4: raw prefix — primary only, prefix filter (today's behavior)
    const { store: primaryStore } = await getContext();
    results = await primaryStore.search({
      query,
      typeFilter,
      maxResults: finalLimit,
      boundary,
      allowFtsFallback: true,
    });
  } else {
    // Case 5: no boundary → federated search across primary + all linked.
    // Pass the `failures` log so the federation path can populate it on
    // store errors without mutating global state. Primary lives in a
    // dedicated slot to avoid colliding with linked-store names.
    results = await federatedSearch(query, typeFilter, finalLimit, finalLimit, failures);
  }

  // Build the runtime-failures warning (if any) once so we can decide
  // whether to skip the "no results" early return for warn-only cases.
  //
  // Only Case 5 (federated) reaches this with `failures` populated:
  // Cases 1/4 bubble primary failures up, Case 2 returns isError early
  // on full linked failure (mmnto/totem#1295 GCA HIGH), Case 3 returns
  // isError immediately. So the IIFE only ever runs in the federated case.
  //
  // Copy branches three ways based on which store(s) failed (mmnto/totem
  // #1295 CR fixes — accurate reporting + no `'primary'` map-key collision).
  const runtimeWarning = (() => {
    if (failureLogIsEmpty(failures)) return null;

    const detailLines: string[] = [];
    if (failures.primary !== null) {
      detailLines.push(`  - primary: ${failures.primary}`);
    }
    for (const [name, err] of failures.linked.entries()) {
      detailLines.push(`  - ${name}: ${err}`);
    }
    const recoveryNote =
      'The store(s) above may recover on a subsequent call if the failure was transient (stale handle, file lock). mmnto/totem#1294.';

    const primaryFailed = failures.primary !== null;
    const linkedFailureCount = failures.linked.size;

    let summary: string;
    if (primaryFailed && linkedFailureCount > 0) {
      summary = `Federated search: primary store and ${linkedFailureCount} linked index(es) failed on this query.`;
    } else if (primaryFailed) {
      summary = `Federated search: primary store failed on this query. Linked stores returned their results normally.`;
    } else {
      summary = `Federated search: ${linkedFailureCount} linked index(es) failed on this query. Other stores returned their results normally.`;
    }

    return formatSystemWarning([summary, '', ...detailLines, '', recoveryNote].join('\n'));
  })();

  // mmnto/totem#1295 CR MAJOR: detect the "entire federation is down" case
  // and return isError instead of a success-shaped "No results found" body.
  //
  // When `boundary === undefined` (federated Case 5), every store we TRIED
  // to query failed, and results came back empty, the agent must see this
  // as an outage — not as "no relevant knowledge found." Otherwise it
  // concludes there's nothing in the index when the entire search plane
  // is actually broken.
  //
  // The condition is narrow on purpose:
  //   - `boundary === undefined`: only the federated case (targeted Cases
  //     2 & 3 have their own isError paths; Cases 1 & 4 bubble primary
  //     failures to the outer reconnect+retry)
  //   - `failures.primary !== null`: primary actually failed (if primary
  //     succeeded with 0 rows, that's a legitimate "no results")
  //   - `failures.linked.size === linkedStores.size`: every linked store
  //     also failed (if ANY linked store succeeded with 0 rows, that
  //     answer is authoritative)
  //
  // Primary failures with at least one healthy linked store still return
  // a success-shaped response with the runtime warning prepended — the
  // linked stores' zero-results answer is authoritative for the query.
  const allFederatedStoresFailed =
    boundary === undefined &&
    failures.primary !== null &&
    failures.linked.size === linkedStores.size;

  // ─── Retrieval envelope + relevance floor (mmnto-ai/totem#2463) ──
  //
  // Floor on the TRUE relevance signal (`r.relevance`, vector-leg similarity),
  // NEVER on the displayed `score` — that is an RRF rank artifact (≈0.016 by
  // construction in hybrid/federated modes), so a floor over it would classify
  // every fused hit as noise. The envelope discloses the outcome machine-
  // readably beside the existing <index-meta> line.
  const configuredFloor =
    typeof config.searchRelevanceFloor === 'number' ? config.searchRelevanceFloor : 0.25;
  const effectiveFloor = minRelevance !== undefined ? minRelevance : configuredFloor;
  const method = deriveSearchMethod(results);

  // Loud degradation notice (Tenet 4 — fail honest): any fts-stamped hit means
  // a store's embedder was unavailable and search fell back to keyword-only.
  const fallbackEngaged = results.some((r) => r.searchMethod === 'fts');
  const fallbackWarning = fallbackEngaged
    ? formatSystemWarning(
        [
          'Embedding provider unavailable — search degraded to KEYWORD-ONLY (FTS) results.',
          '',
          'These matches carry NO semantic relevance signal (relevance is n/a); vector-similarity ranking is disabled until the embedder is restored. Fix the configured provider/API key or start Ollama, then retry for semantic results. (mmnto-ai/totem#2463)',
        ].join('\n'),
      )
    : null;

  // Best relevance = max over hits that CARRY a relevance signal. Empty-safe:
  // only spread into Math.max when non-empty (else it yields -Infinity). `null`
  // encodes "no hit carried a relevance signal" — the floor never fires then.
  const relevances = results
    .map((r) => r.relevance)
    .filter((x): x is number => typeof x === 'number');
  const hasRelevanceSignal = relevances.length > 0;
  const bestRelevance = hasRelevanceSignal ? Math.max(...relevances) : null;

  if (results.length === 0) {
    if (allFederatedStoresFailed) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              runtimeWarning ??
              '[Totem Error] Federated search failed: every queried store errored.', // totem-ignore mmnto-ai/totem#1294 — system-generated + XML-wrapped
          },
        ],
        isError: true,
      };
    }
    const emptyEnvelope = formatRetrievalEnvelope({
      status: 'empty',
      method,
      bestRelevance,
      floor: effectiveFloor,
      hits: 0,
    });
    const body = formatXmlResponse('knowledge', 'No results found.');
    const text = composeResponseText({
      fallbackWarning,
      runtimeWarning,
      staleWarning,
      indexEnvelope,
      retrievalEnvelope: emptyEnvelope,
      body,
    }); // totem-ignore mmnto-ai/totem#1294 — composed from system-generated + XML-wrapped pieces
    return { content: [{ type: 'text' as const, text }] };
  }

  // Floor fires ONLY when a real relevance signal exists — a pure-FTS corpus
  // (no vector relevance to report) is never demoted to no_useful_hits.
  if (hasRelevanceSignal && bestRelevance !== null && bestRelevance < effectiveFloor) {
    const belowFloorEnvelope = formatRetrievalEnvelope({
      status: 'no_useful_hits',
      method,
      bestRelevance,
      floor: effectiveFloor,
      hits: results.length,
    });
    // Disclose every below-floor candidate compactly (path + relevance, NO
    // content) — exclusion is disclosed, never silently dropped (Prop 308 F1).
    const candidateLines = results.map((r, i) => {
      const rel = typeof r.relevance === 'number' ? r.relevance.toFixed(3) : 'n/a';
      const label = r.sourceRepo ? `[${r.sourceRepo}] ` + r.absoluteFilePath : r.absoluteFilePath;
      return `${i + 1}. ${label} — relevance ${rel}`;
    });
    const body = formatXmlResponse(
      'knowledge',
      [
        `No results met the relevance floor of ${effectiveFloor.toFixed(3)} (best relevance ${bestRelevance.toFixed(3)}).`,
        '',
        'Below-floor candidates (disclosed, not returned — path + relevance only):',
        ...candidateLines,
      ].join('\n'),
    );
    const text = composeResponseText({
      fallbackWarning,
      runtimeWarning,
      staleWarning,
      indexEnvelope,
      retrievalEnvelope: belowFloorEnvelope,
      body,
    }); // totem-ignore mmnto-ai/totem#1294 — composed from system-generated + XML-wrapped pieces
    return { content: [{ type: 'text' as const, text }] };
  }

  const okEnvelope = formatRetrievalEnvelope({
    status: 'ok',
    method,
    bestRelevance,
    floor: effectiveFloor,
    hits: results.length,
  });
  const formatted = results.map((r, i) => formatResult(r, i)).join('\n\n---\n\n');

  const knowledgeBody = formatXmlResponse('knowledge', formatted);
  let text = composeResponseText({
    fallbackWarning,
    runtimeWarning,
    staleWarning,
    indexEnvelope,
    retrievalEnvelope: okEnvelope,
    body: knowledgeBody,
  }); // totem-ignore mmnto-ai/totem#1294 — composed from system-generated + XML-wrapped pieces

  // Append a system warning when the payload is large enough to risk context pressure
  if (text.length > config.contextWarningThreshold) {
    text +=
      '\n\n' +
      formatSystemWarning(
        'You just ingested a large amount of context. You may be at risk of forgetting earlier instructions. ' +
          'Consider warning the user about context pressure and suggest running `totem handoff` to capture mid-session state.',
      );
  }

  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Compose the final response text by stacking diagnostics on top of the
 * knowledge body. Order (outermost → innermost):
 *
 *   1. fallback warning (embedder down → keyword-only; mmnto-ai/totem#2463)
 *   2. runtime warning (per-call store failures from federatedSearch)
 *   3. STALE warning (knowledge index >7 days old; mmnto-ai/totem#2029)
 *   4. index-meta envelope (always-present freshness metadata)
 *   5. retrieval envelope (machine-parsable outcome; mmnto-ai/totem#2463) —
 *      emitted directly below <index-meta> so both parse as adjacent XML lines
 *   6. body (the wrapped `<knowledge>` block OR "no results")
 *
 * Pieces are joined by blank lines so each is its own logical block in
 * the agent's view. Null pieces are omitted; the body is required.
 */
function composeResponseText(parts: {
  fallbackWarning: string | null;
  runtimeWarning: string | null;
  staleWarning: string | null;
  indexEnvelope: string;
  retrievalEnvelope: string;
  body: string;
}): string {
  const blocks: string[] = [];
  if (parts.fallbackWarning) blocks.push(parts.fallbackWarning);
  if (parts.runtimeWarning) blocks.push(parts.runtimeWarning);
  if (parts.staleWarning) blocks.push(parts.staleWarning);
  blocks.push(parts.indexEnvelope);
  blocks.push(parts.retrievalEnvelope);
  blocks.push(parts.body);
  return blocks.join('\n\n');
}

export function registerSearchKnowledge(server: McpServer): void {
  server.registerTool(
    'search_knowledge',
    {
      description: `Search the Totem knowledge index for relevant code, session logs, specs, or lessons. Use this BEFORE writing code, reviewing PRs, or making architectural decisions to retrieve domain constraints, past traps, and established patterns.`,
      inputSchema: {
        query: z.string().describe('The search query'),
        type_filter: z
          .enum(ContentTypeSchema.options)
          .optional()
          .describe('Filter results by content type: code, session_log, or spec'),
        max_results: z
          .number()
          .int()
          .positive()
          .max(MAX_SEARCH_RESULTS)
          .optional()
          .describe(`Maximum number of results to return (default: 5, max: ${MAX_SEARCH_RESULTS})`),
        // Normalize blank/whitespace boundaries to undefined so they take
        // the federated default path. Without this, "" and "   " fall into
        // the raw-prefix branch and silently drop linked-repo federation.
        // mmnto/totem#1295 CR fix — input sanitization at the MCP boundary.
        boundary: z
          .preprocess((value) => {
            if (typeof value !== 'string') return value;
            const trimmed = value.trim();
            return trimmed === '' ? undefined : trimmed;
          }, z.string().optional())
          .describe(
            'Partition name, linked-index name, or file path prefix to scope results. Resolution order: (1) configured partition names (e.g., "core", "cli", "mcp") → primary index, prefix-filtered; (2) linked-index names from linkedIndexes config (e.g., "strategy") → routes only to that cross-repo index; (3) raw path prefixes (e.g., "src/components/") → primary, prefix-filtered. When omitted, search federates across primary + all linked indexes, merging by semantic score. Blank or whitespace-only values are normalized to "omitted" (federated default).',
          ),
        // mmnto-ai/totem#2463: per-call relevance floor override. Floors on the
        // true vector-leg relevance (0..1), NOT the displayed RRF score. Below
        // it, the tool reports status="no_useful_hits" and discloses the
        // below-floor candidates instead of returning noise. Overrides the
        // config `searchRelevanceFloor`; the retrieval-envelope always reports
        // the effective floor.
        min_relevance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            'Minimum per-hit relevance (0..1, vector-leg similarity) to treat results as useful. Overrides the configured searchRelevanceFloor. Below it, status is "no_useful_hits" with the below-floor candidates disclosed.',
          ),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ query, type_filter, max_results, boundary, min_relevance }) => {
      const start = Date.now();
      // A.3.a: emit `mcp_call` activity event to the Trap Ledger. Fire-and-forget;
      // the ledger write must not block or break the tool call (Tenet 4 + sensor
      // semantics per lesson-b1bae311). This is the writer half of the
      // ADR-029 compliance metric — A.3.b reads these events to compute
      // "% of sessions where search_knowledge fired before first file write."
      //
      // logMcpCall has its own internal try/catch, but defense-in-depth with
      // .catch() guards against any unhandledRejection if internals ever
      // throw synchronously between awaits.
      logMcpCall('search_knowledge').catch((err) => {
        void err;
      });
      try {
        // Initialize log directory on first call (lazy — avoids loading config at import time)
        try {
          const { projectRoot, config } = await getContext();
          setLogDir(path.join(projectRoot, config.totemDir));
        } catch (err) {
          // Non-fatal — logging just won't write to disk. Record the failure.
          logSearch({
            timestamp: new Date().toISOString(),
            query: 'internal:set-log-dir',
            resultCount: 0,
            durationMs: 0,
            topScore: null,
            error: `Failed to set log dir: ${err instanceof Error ? err.message : String(err)}`,
          });
        }

        // First-query health gate — blocks on dimension mismatch, warns on other issues
        const healthWarning = await runFirstQueryHealthCheck();

        // Dimension mismatch is fatal — search will crash with a cryptic LanceDB error
        if (healthWarning && healthWarning.includes('DIMENSION MISMATCH')) {
          return {
            content: [{ type: 'text' as const, text: healthWarning }], // totem-ignore #1294 — healthWarning is from formatSystemWarning (already XML-wrapped)
            isError: true,
          };
        }

        // First-query linked-stores gate — non-blocking (mmnto/totem#1294 Phase 2).
        // Surfaces init failures so the agent sees them in-context on the first
        // search_knowledge call. Unlike dimension mismatch, linked-store failures
        // are always recoverable (degrade to primary-only), so we don't set
        // isError — we just prepend the warning to the result content below.
        const linkedStoresWarning = await runFirstLinkedStoresCheck();

        let result: ToolResult;
        try {
          result = await performSearch(query, type_filter, max_results, boundary, min_relevance);
          // totem-context: the catch below is not a silent swallow; a failed reconnect+retry is surfaced to the agent as an isError ToolResult.
        } catch (originalErr) {
          // Any LanceDB error could indicate a stale handle (e.g. files deleted
          // during a full sync rebuild). Reconnect and retry once before failing.
          try {
            await reconnectStore();
            result = await performSearch(query, type_filter, max_results, boundary, min_relevance);
          } catch (retryErr) {
            // Retry failed — report both errors for diagnostics
            const originalMessage =
              originalErr instanceof Error ? originalErr.message : String(originalErr);
            const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);

            const errorText =
              originalMessage === retryMessage
                ? `[Totem Error] Search failed: ${originalMessage}`
                : `[Totem Error] Search failed. Initial error: ${originalMessage}. Retry after reconnect also failed: ${retryMessage}`;

            logSearch({
              timestamp: new Date().toISOString(),
              query,
              typeFilter: type_filter,
              resultCount: 0,
              durationMs: Date.now() - start,
              topScore: null,
              error: errorText,
            });

            return {
              content: [{ type: 'text' as const, text: errorText }],
              isError: true,
            };
          }
        }

        // Extract result count and top score from the successful response
        const resultText = result.content[0]?.text ?? '';
        const scoreMatches = [...resultText.matchAll(/\*\*Score:\*\* ([\d.]+)/g)];
        const topScore = scoreMatches.length > 0 ? parseFloat(scoreMatches[0]![1]!) : null;

        // mmnto-ai/totem#2463: record best relevance alongside topScore. Parsed
        // from the retrieval-envelope's bestRelevance attribute (same derive-
        // from-response-text pattern as topScore); "n/a" → null (no signal).
        const relevanceMatch = resultText.match(
          /<retrieval-envelope[^>]*\bbestRelevance="([^"]+)"/,
        );
        const bestRelevanceRaw = relevanceMatch?.[1];
        const topRelevance =
          bestRelevanceRaw !== undefined && bestRelevanceRaw !== 'n/a'
            ? parseFloat(bestRelevanceRaw)
            : null;

        // Log error responses (e.g., the broken-linked-boundary path at
        // performSearch Case 3) as errors instead of zero-result successes,
        // so routing failures are visible in search-log.jsonl. Without this
        // branch, isError responses would be indistinguishable from "no
        // matches found." mmnto/totem#1295 CR fix.
        if (result.isError) {
          logSearch({
            timestamp: new Date().toISOString(),
            query,
            typeFilter: type_filter,
            boundary,
            resultCount: 0,
            durationMs: Date.now() - start,
            topScore: null,
            error: resultText,
          });
        } else {
          logSearch({
            timestamp: new Date().toISOString(),
            query,
            typeFilter: type_filter,
            boundary,
            resultCount: scoreMatches.length,
            durationMs: Date.now() - start,
            topScore,
            topRelevance,
          });
        }

        // Prepend health warning and linked-stores warning to the first search
        // result if issues were found. Order is deliberate: health first
        // (local index issues are higher priority), then linked-stores second.
        const warnings: string[] = [];
        if (healthWarning) warnings.push(healthWarning);
        if (linkedStoresWarning) warnings.push(linkedStoresWarning); // totem-ignore #1294 — system-generated
        if (warnings.length > 0 && result.content.length > 0) {
          result.content[0] = {
            type: 'text' as const,
            text: warnings.join('\n\n') + '\n\n' + result.content[0]!.text, // totem-ignore #1294 — all system-generated + XML-wrapped
          };
        }

        return result;
      } catch (err) {
        // Catch-all: log unexpected errors that bypass the inner try/catch
        const errorMessage = err instanceof Error ? err.message : String(err);
        logSearch({
          timestamp: new Date().toISOString(),
          query,
          typeFilter: type_filter,
          resultCount: 0,
          durationMs: Date.now() - start,
          topScore: null,
          error: errorMessage,
        });
        throw err;
      }
    },
  );
}
