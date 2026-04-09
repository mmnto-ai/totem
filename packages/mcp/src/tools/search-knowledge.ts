import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ContentType, HealthCheckResult, SearchResult } from '@mmnto/totem';
import { ContentTypeSchema } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';
import { logSearch, setLogDir } from '../search-log.js';
import { formatSystemWarning, formatXmlResponse } from '../xml-format.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

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
  firstLinkedStoresCheckDone = true;

  try {
    const { linkedStoreInitErrors } = await getContext();
    if (linkedStoreInitErrors.size === 0) return null;

    const lines: string[] = [
      `Cross-Repo Context Mesh: ${linkedStoreInitErrors.size} linked index(es) failed to initialize.`,
      '',
      'Federated search will proceed using only the stores that initialized successfully. Fix the issues below so cross-repo queries return complete context. (mmnto/totem#1294)',
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
  firstHealthCheckDone = true;

  try {
    const { store } = await getContext();
    const result: HealthCheckResult = await store.healthCheck();

    if (result.healthy) return null;

    // Dimension mismatch is a blocking error — search will fail with a cryptic LanceDB error
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

    // Build actionable warning lines for other issues
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
  // Use absolute path for linked results so agents can Read() them directly.
  // Primary results keep the relative path for display compactness — they
  // resolve against cwd naturally.
  const fileDisplay = r.sourceRepo ? r.absoluteFilePath : r.filePath;
  return (
    `### ${index + 1}. ${labelWithTag} (${r.type})\n` +
    `**File:** ${fileDisplay} | **Score:** ${r.score.toFixed(3)}\n\n` +
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
 * failure into the caller-provided `runtimeFailures` map and return
 * empty for that store on THIS query only. This function DOES NOT
 * mutate the global `linkedStores` or `linkedStoreInitErrors` maps —
 * an earlier revision evicted failing stores to avoid log spam, but
 * GCA + CR both flagged that as a Tenet 4 violation: transient errors
 * (file locks during parallel sync, network blips) caused permanent
 * context loss until server restart. The correct tradeoff is to accept
 * some log spam for resilience, and surface runtime failures via the
 * per-request warning path (see `performSearch`).
 *
 * mmnto/totem#1294 Phase 2 + mmnto/totem#1295 fix.
 */
async function federatedSearch(
  query: string,
  typeFilter: ContentType | undefined,
  perStoreLimit: number,
  finalLimit: number,
  runtimeFailures: Map<string, string>,
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
  // second failure, log and record into `runtimeFailures` under the
  // reserved 'primary' key. Promise.all never rejects from the primary slot.
  const hasLinkedStores = linkedStores.size > 0;
  const primaryPromise = hasLinkedStores
    ? primaryStore
        .search({ query, typeFilter, maxResults: perStoreLimit })
        .catch(async (err: unknown) => {
          const firstMsg = err instanceof Error ? err.message : String(err);
          try {
            await primaryStore.reconnect();
            return await primaryStore.search({ query, typeFilter, maxResults: perStoreLimit });
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
            runtimeFailures.set('primary', combinedMsg);
            return [] as SearchResult[];
          }
        })
    : primaryStore.search({ query, typeFilter, maxResults: perStoreLimit });

  // Linked stores: catch per-store failures so one broken linked index
  // doesn't break the overall query. On failure, attempt targeted
  // reconnect + retry, then return empty for this query (populating
  // `runtimeFailures` for the caller to surface). Global state is
  // NEVER mutated here — the store stays in `linkedStores` so the next
  // query can try again (the transient issue may have cleared).
  const linkedPromises = Array.from(linkedStores.entries()).map(([name, ls]) =>
    ls.search({ query, typeFilter, maxResults: perStoreLimit }).catch(async (err) => {
      const firstMsg = err instanceof Error ? err.message : String(err);
      try {
        await ls.reconnect();
        return await ls.search({ query, typeFilter, maxResults: perStoreLimit });
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
        runtimeFailures.set(name, combinedMsg);
        return [] as SearchResult[];
      }
    }),
  );

  const [primaryResults, ...linkedResults] = await Promise.all([primaryPromise, ...linkedPromises]);

  const merged: SearchResult[] = [...primaryResults, ...linkedResults.flat()];
  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return merged.slice(0, finalLimit);
}

async function performSearch(
  query: string,
  typeFilter?: ContentType,
  maxResults?: number,
  boundary?: string,
): Promise<ToolResult> {
  const { config, linkedStores, linkedStoreInitErrors } = await getContext();
  const finalLimit = maxResults ?? 5;

  // Per-query runtime failure tracking (mmnto/totem#1295 CR MAJOR fix).
  // Populated by `federatedSearch` when a linked store errors during
  // this specific query. Surfaced as a compact system warning on the
  // response so the agent sees the failure in-context — NOT gated by
  // any session-level "already warned" flag. Every query where a
  // linked store fails produces its own warning; this is the correct
  // Tenet 4 tradeoff versus the earlier one-shot snapshot approach.
  const runtimeFailures = new Map<string, string>();

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
    });
  } else if (boundary !== undefined && linkedStores.has(boundary)) {
    // Case 2: linked store name — route ONLY to that linked store.
    // Runtime failures on the explicit-boundary path are captured into
    // `runtimeFailures` the same way federatedSearch does, so the agent
    // sees a warning if this specific linked store fails mid-query.
    const linked = linkedStores.get(boundary)!;
    try {
      results = await linked.search({ query, typeFilter, maxResults: finalLimit });
    } catch (err) {
      const firstMsg = err instanceof Error ? err.message : String(err);
      try {
        await linked.reconnect();
        results = await linked.search({ query, typeFilter, maxResults: finalLimit });
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        runtimeFailures.set(
          boundary,
          `search failed (initial: ${firstMsg}; reconnect+retry: ${retryMsg})`,
        );
        results = [];
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
    });
  } else {
    // Case 5: no boundary → federated search across primary + all linked.
    // Pass the runtimeFailures map so the federation path can populate
    // it on linked-store errors without mutating global state.
    results = await federatedSearch(query, typeFilter, finalLimit, finalLimit, runtimeFailures);
  }

  // Build the runtime-failures warning (if any) once so we can decide
  // whether to skip the "no results" early return for warn-only cases.
  // Copy branches on `boundary` because the targeted (Case 2) path only
  // queries one linked store — the federated copy ("Other stores returned
  // their results normally") would be a lie there. mmnto/totem#1295 CR fix.
  const runtimeWarning =
    runtimeFailures.size > 0
      ? formatSystemWarning(
          boundary === undefined
            ? [
                `Federated search: ${runtimeFailures.size} linked index(es) failed on this query.`,
                '',
                ...Array.from(runtimeFailures.entries()).map(
                  ([name, err]) => `  - ${name}: ${err}`,
                ),
                '',
                'Other stores returned their results normally. The linked store(s) above may recover on a subsequent call if the failure was transient (stale handle, file lock). mmnto/totem#1294.',
              ].join('\n')
            : [
                `Linked-store search: targeted index "${boundary}" failed on this query.`,
                '',
                ...Array.from(runtimeFailures.entries()).map(
                  ([name, err]) => `  - ${name}: ${err}`,
                ),
                '',
                'No other stores were queried for this request. The linked store may recover on a subsequent call if the failure was transient (stale handle, file lock). mmnto/totem#1294.',
              ].join('\n'),
        )
      : null;

  if (results.length === 0) {
    const body = formatXmlResponse('knowledge', 'No results found.');
    const text = runtimeWarning ? runtimeWarning + '\n\n' + body : body; // totem-ignore #1294 — system-generated + XML-wrapped
    return { content: [{ type: 'text' as const, text }] };
  }

  const formatted = results.map((r, i) => formatResult(r, i)).join('\n\n---\n\n');

  let text = formatXmlResponse('knowledge', formatted);

  // Prepend the per-query runtime warning if federatedSearch populated it
  if (runtimeWarning) {
    text = runtimeWarning + '\n\n' + text; // totem-ignore #1294 — system-generated + XML-wrapped
  }

  // Append a system warning when the payload is large enough to risk context pressure
  if (text.length > config.contextWarningThreshold) {
    text +=
      '\n\n' +
      formatSystemWarning(
        'You just ingested a large amount of context. You may be at risk of forgetting earlier instructions. ' +
          'Consider warning the user about context pressure and suggest running `totem bridge` to consolidate.',
      );
  }

  return { content: [{ type: 'text' as const, text }] };
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
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ query, type_filter, max_results, boundary }) => {
      const start = Date.now();
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
          result = await performSearch(query, type_filter, max_results, boundary);
        } catch (originalErr) {
          // Any LanceDB error could indicate a stale handle (e.g. files deleted
          // during a full sync rebuild). Reconnect and retry once before failing.
          try {
            await reconnectStore();
            result = await performSearch(query, type_filter, max_results, boundary);
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
