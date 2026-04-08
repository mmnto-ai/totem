/**
 * Cross-Repo Context Mesh smoke test (mmnto/totem#1294 Phase 3).
 *
 * Manual integration test that spins up a real ServerContext against the
 * current cwd's totem.config.ts, validates every linked index initialized
 * correctly, runs a real federated search_knowledge query across primary
 * + linked stores, and prints formatted output showing:
 *
 *   - Which linked stores loaded vs which failed (with init errors)
 *   - How many chunks each store holds
 *   - The top-N merged results with `[sourceRepo]` tags and absolute paths
 *   - A per-store score breakdown so reviewers can verify federation
 *     actually interleaves results from multiple repos
 *
 * This is NOT part of the automated test suite — it requires:
 *   1. A real `.lancedb/` in the primary repo (rebuilt via `totem sync`)
 *   2. `linkedIndexes` configured in `totem.config.ts` pointing at real paths
 *   3. Each linked path to be a fully-synced Totem-managed directory
 *   4. `GEMINI_API_KEY` (or equivalent) in the environment for live query
 *      embedding
 *
 * Invoke after building the mcp package:
 *   pnpm --filter @mmnto/mcp build
 *   node packages/mcp/dist/smoke-test.js
 *
 * Captures its own output to stdout so a caller can redirect to a file or
 * pipe the result into a PR body. Exits non-zero on any failure (broken
 * init, zero results, or the context throwing) so CI / reviewers can use
 * it as a binary pass/fail signal.
 */

import { getContext } from './context.js';

const QUERY = 'cross-repo context mesh federation linked totems';

interface FormattedResult {
  rank: number;
  source: string;
  label: string;
  score: string;
  path: string;
  contentPreview: string;
}

function formatResults(
  results: ReadonlyArray<{
    label: string;
    score: number;
    filePath: string;
    absoluteFilePath: string;
    sourceRepo?: string;
    content: string;
  }>,
): FormattedResult[] {
  return results.map((r, i) => ({
    rank: i + 1,
    source: r.sourceRepo ?? 'primary',
    label: r.label,
    score: r.score.toFixed(3),
    path: r.sourceRepo ? r.absoluteFilePath : r.filePath,
    contentPreview: r.content.slice(0, 120).replace(/\s+/g, ' ').trim() + '...',
  }));
}

async function main(): Promise<void> {
  console.log('='.repeat(78));
  console.log('Cross-Repo Context Mesh — smoke test (mmnto/totem#1294 Phase 3)');
  console.log('='.repeat(78));
  console.log();

  // Capture init timing — helps prove the eager-init path doesn't block
  // forever on broken links
  const initStart = Date.now();
  const ctx = await getContext();
  const initMs = Date.now() - initStart;

  console.log(`Primary repo:         ${ctx.projectRoot}`);
  console.log(`Init wall time:       ${initMs}ms`);
  console.log(`Linked stores loaded: ${ctx.linkedStores.size}`);
  console.log(`Linked init errors:   ${ctx.linkedStoreInitErrors.size}`);
  console.log();

  // Report primary chunk count — sanity check that the primary store loaded
  const primaryCount = await ctx.store.count();
  console.log(`Primary chunks: ${primaryCount.toLocaleString()}`);

  if (ctx.linkedStores.size > 0) {
    console.log();
    console.log('Linked stores:');
    for (const [name, store] of ctx.linkedStores.entries()) {
      const count = await store.count();
      console.log(`  [${name}]: ${count.toLocaleString()} chunks`);
    }
  }

  if (ctx.linkedStoreInitErrors.size > 0) {
    console.log();
    console.log('Linked init errors:');
    for (const [name, err] of ctx.linkedStoreInitErrors.entries()) {
      console.log(`  [${name}]: ${err}`);
    }
  }

  if (ctx.linkedStores.size === 0) {
    console.log();
    console.log('WARNING: No linked stores initialized. This smoke test cannot');
    console.log('demonstrate cross-repo federation without at least one linked');
    console.log('store. Check totem.config.ts for linkedIndexes entries.');
    process.exit(1);
  }

  // ─── Run the federated query ──────────────────────────────
  //
  // Fire primary + all linked stores in parallel — mirroring the exact
  // pattern federatedSearch uses in search-knowledge.ts. Each store gets
  // an equal per-store fetch budget.

  console.log();
  console.log('='.repeat(78));
  console.log(`Query: "${QUERY}"`);
  console.log('='.repeat(78));
  console.log();

  const queryStart = Date.now();

  const perStoreLimit = 5;
  const finalLimit = 10;

  const primaryPromise = ctx.store.search({
    query: QUERY,
    maxResults: perStoreLimit,
  });

  const linkedPromises = Array.from(ctx.linkedStores.entries()).map(([name, ls]) =>
    ls.search({ query: QUERY, maxResults: perStoreLimit }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [${name}] search failed: ${msg}`);
      return [] as Array<{
        label: string;
        score: number;
        filePath: string;
        absoluteFilePath: string;
        sourceRepo?: string;
        content: string;
      }>;
    }),
  );

  const [primaryResults, ...linkedResults] = await Promise.all([primaryPromise, ...linkedPromises]);

  const queryMs = Date.now() - queryStart;

  // Merge by semantic score (descending) and truncate — same pattern as
  // federatedSearch in search-knowledge.ts
  const merged = [...primaryResults, ...linkedResults.flat()];
  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topResults = merged.slice(0, finalLimit);

  // Per-store breakdown for the PR body
  const primaryHits = primaryResults.length;
  const linkedHitsByName = new Map<string, number>();
  for (const [name, linkedRes] of ctx.linkedStores.entries()) {
    // Re-run to get count; the parallel results above lost the per-store mapping
    void linkedRes; // avoid unused variable
    linkedHitsByName.set(name, 0);
  }
  for (const r of merged) {
    if (r.sourceRepo) {
      linkedHitsByName.set(r.sourceRepo, (linkedHitsByName.get(r.sourceRepo) ?? 0) + 1);
    }
  }

  console.log(`Query wall time:    ${queryMs}ms`);
  console.log(`Primary hits:       ${primaryHits}`);
  for (const [name, count] of linkedHitsByName.entries()) {
    console.log(`Linked hits [${name}]: ${count}`);
  }
  console.log(`Merged pool size:   ${merged.length}`);
  console.log(`Top returned:       ${topResults.length}`);
  console.log();

  // ─── Formatted results ────────────────────────────────────

  if (topResults.length === 0) {
    console.log('NO RESULTS. The query returned zero matches from primary or linked.');
    console.log('This likely means the indexes are not synced or the query is too narrow.');
    process.exit(1);
  }

  const formatted = formatResults(topResults);

  console.log('Top-ranked results (interleaved by semantic score):');
  console.log();

  for (const r of formatted) {
    console.log(`${r.rank}. [${r.source}] ${r.label}`);
    console.log(`   Score: ${r.score}`);
    console.log(`   Path:  ${r.path}`);
    console.log(`   Preview: ${r.contentPreview}`);
    console.log();
  }

  // ─── Pass/fail signal ─────────────────────────────────────

  // Success conditions:
  //   1. Init had zero errors (all linked stores loaded cleanly)
  //   2. At least one linked store returned hits
  //   3. Merge produced an interleaved result set (not just primary or just linked)
  const hasLinkedHits = Array.from(linkedHitsByName.values()).some((n) => n > 0);
  const hasPrimaryHits = primaryHits > 0;
  const zeroInitErrors = ctx.linkedStoreInitErrors.size === 0;

  console.log('='.repeat(78));
  console.log('Smoke test verdict:');
  console.log(`  Zero init errors:       ${zeroInitErrors ? 'PASS' : 'FAIL'}`);
  console.log(`  Primary returned hits:  ${hasPrimaryHits ? 'PASS' : 'FAIL'}`);
  console.log(`  Linked returned hits:   ${hasLinkedHits ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(78));

  const verdict = zeroInitErrors && hasPrimaryHits && hasLinkedHits;
  console.log();
  console.log(verdict ? 'SMOKE TEST: PASS' : 'SMOKE TEST: FAIL');

  process.exit(verdict ? 0 : 1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error('Smoke test threw:', msg);
  if (stack) console.error(stack);
  process.exit(1);
});
