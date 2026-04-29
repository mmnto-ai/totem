#!/usr/bin/env tsx
/**
 * Benchmark LanceDB connection open cost for mmnto/totem#1418.
 *
 * Drives the decision between reopen-per-query and mtime-check-and-reopen
 * strategies for the MCP stale-handle fix. If per-open cost sits below ~10ms,
 * reopening on every query is acceptable. If it runs above ~50ms, mtime
 * gating wins. Numbers above 10ms but below 50ms are a tradeoff call.
 *
 * Usage:
 *   pnpm tsx scripts/bench-lance-open.ts [path-to-lancedb]
 *
 * Default path: `<strategyRoot>/.lancedb` resolved via `resolveStrategyRoot`
 * (mmnto-ai/totem#1710). When the strategy root is unresolvable, the script
 * hard-fails with an actionable message; explicit positional arg always
 * wins over the resolver default.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';

// Resolve @lancedb/lancedb through the `packages/core` package, since this
// script lives at the repo root and the root has no direct dependency on
// LanceDB (it's transitively held by @mmnto/totem).
const localRequire = createRequire(path.resolve(process.cwd(), 'packages/core/package.json'));
const lancedb = localRequire('@lancedb/lancedb') as typeof import('@lancedb/lancedb');

import { resolveStrategyRoot } from '../packages/core/src/strategy-resolver.js';

const TABLE_NAME = 'totem_chunks';

async function main(): Promise<void> {
  let dbPath = process.argv[2];
  if (dbPath === undefined) {
    const strategyStatus = resolveStrategyRoot(process.cwd());
    if (!strategyStatus.resolved) {
      console.error(`[bench] Cannot resolve default LanceDB path: ${strategyStatus.reason}`);
      console.error(
        '[bench] Pass an explicit path (e.g., `pnpm tsx scripts/bench-lance-open.ts /path/to/.lancedb`) or set TOTEM_STRATEGY_ROOT.',
      );
      process.exit(1);
    }
    dbPath = path.join(strategyStatus.path, '.lancedb');
  }
  const iterations = Number(process.env.ITERATIONS ?? '100');

  console.log(`[bench] dbPath=${dbPath} iterations=${iterations}`);

  // Warm up — exclude the first few opens so the measurement reflects steady state.
  for (let i = 0; i < 3; i += 1) {
    const db = await lancedb.connect(dbPath);
    await db.tableNames();
    db.close();
  }

  const connectTimings: number[] = [];
  const openTableTimings: number[] = [];
  const totalTimings: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    const db = await lancedb.connect(dbPath);
    const t1 = performance.now();
    const names = await db.tableNames();
    let table = null;
    if (names.includes(TABLE_NAME)) {
      table = await db.openTable(TABLE_NAME);
    }
    const t2 = performance.now();
    db.close();

    connectTimings.push(t1 - t0);
    openTableTimings.push(t2 - t1);
    totalTimings.push(t2 - t0);

    // Silence unused warning
    void table;
  }

  printStats('lancedb.connect()', connectTimings);
  printStats('tableNames() + openTable()', openTableTimings);
  printStats('TOTAL (connect + open)', totalTimings);
}

function printStats(label: string, timings: number[]): void {
  const sorted = [...timings].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const median = sorted[Math.floor(n / 2)]!;
  const p95 = sorted[Math.floor(n * 0.95)]!;
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  console.log(`\n[${label}]`);
  console.log(
    `  n=${n}  avg=${avg.toFixed(2)}ms  median=${median.toFixed(2)}ms  p95=${p95.toFixed(2)}ms  min=${min.toFixed(2)}ms  max=${max.toFixed(2)}ms`,
  );
}

main().catch((err) => {
  console.error('[bench] failed:', err);
  process.exit(1);
});
