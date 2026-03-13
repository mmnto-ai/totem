#!/usr/bin/env npx tsx
/**
 * Embedding Retrieval Quality Evaluation
 *
 * Compares retrieval recall across embedding providers using Totem's own
 * codebase + lessons as the corpus. Runs a fixed set of curated queries
 * and measures Recall@5 and Recall@10 for each provider.
 *
 * Usage:
 *   OPENAI_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/eval-embeddings.ts
 *
 * Requires both API keys to run comparison. Pass --provider=openai or
 * --provider=gemini to eval a single provider.
 *
 * @see .strategy/adr/adr-024-vectordb-multi-type-schema.md (Appendix)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentType } from '../packages/core/src/config-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Dynamic imports — avoids build issues, these are project-local
async function loadTotem() {
  const core = await import('../packages/core/src/index.js');
  return core;
}

// ─── Eval dataset ──────────────────────────────────────
// Each query has expected matches: file paths (or substrings) that SHOULD
// appear in the top-k results. Recall = |found ∩ expected| / |expected|.

interface EvalQuery {
  query: string;
  description: string;
  /** Substrings that should appear in result file paths or labels */
  expectedMatches: string[];
  /** Optional type filter */
  typeFilter?: 'code' | 'lesson' | 'spec' | 'session_log';
}

const EVAL_QUERIES: EvalQuery[] = [
  {
    query: 'createEmbedder factory function embedding provider',
    description: 'Find the embedder factory',
    expectedMatches: ['embedder.ts'],
  },
  {
    query: 'LanceDB backtick quoting DataFusion case sensitive column',
    description: 'Find the backtick quoting trap lesson',
    expectedMatches: ['lessons.md'],
    typeFilter: 'lesson',
  },
  {
    query: 'LanceStore vector search semantic query',
    description: 'Find the LanceStore search implementation',
    expectedMatches: ['lance-store.ts'],
  },
  {
    query: 'totem sync incremental re-index changed files',
    description: 'Find the sync pipeline',
    expectedMatches: ['pipeline.ts'],
  },
  {
    query: 'markdown chunker heading parsing remark',
    description: 'Find the markdown chunker',
    expectedMatches: ['markdown-chunker.ts'],
  },
  {
    query: 'configuration tier lite standard full embedding',
    description: 'Find the config tier logic',
    expectedMatches: ['config-schema.ts'],
  },
  {
    query: 'shield deterministic compiled rules regex violation',
    description: 'Find the shield/compiler logic',
    expectedMatches: ['compiler.ts', 'shield.ts'],
  },
  {
    query: 'add lesson persist memory learning loop',
    description: 'Find the add_lesson tool',
    expectedMatches: ['add-lesson.ts', 'lessons'],
  },
  {
    query: 'drift detection stale file reference lesson',
    description: 'Find the drift detector',
    expectedMatches: ['drift-detector.ts'],
  },
  {
    query: 'session log hierarchical breadcrumb chunking',
    description: 'Find the session log chunker',
    expectedMatches: ['session-log-chunker.ts'],
  },
  {
    query: 'export lessons copilot gemini styleguide sentinel',
    description: 'Find the exporter',
    expectedMatches: ['exporter.ts'],
  },
  {
    query: 'retry error handling stale database handle reconnect',
    description: 'Find error handling lessons',
    expectedMatches: ['lessons.md'],
    typeFilter: 'lesson',
  },
  {
    query: 'TypeScript AST function class interface component chunking',
    description: 'Find the TypeScript chunker',
    expectedMatches: ['typescript-chunker.ts'],
  },
  {
    query: 'sanitize adversarial prompt injection ingestion',
    description: 'Find the sanitization logic',
    expectedMatches: ['sanitize.ts'],
  },
  {
    query: 'orchestrator gemini anthropic openai LLM provider',
    description: 'Find orchestrator implementations',
    expectedMatches: ['orchestrator.ts', 'gemini-orchestrator.ts'],
  },
];

// ─── Eval runner ───────────────────────────────────────

interface ProviderResult {
  provider: string;
  queries: {
    query: string;
    description: string;
    recallAt5: number;
    recallAt10: number;
    topResults: { label: string; filePath: string; score: number }[];
    matchedAt5: string[];
    matchedAt10: string[];
    missed: string[];
  }[];
  avgRecallAt5: number;
  avgRecallAt10: number;
  syncDurationMs: number;
}

async function evalProvider(
  providerName: string,
  config: Record<string, unknown>,
): Promise<ProviderResult> {
  const totem = await loadTotem();
  const { TotemConfigSchema } = totem;

  // Build a config with just the basics for sync
  const evalConfig = TotemConfigSchema.parse({
    targets: [
      { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
      { glob: 'README.md', type: 'spec', strategy: 'markdown-heading' },
      { glob: 'CLAUDE.md', type: 'spec', strategy: 'markdown-heading' },
      { glob: 'docs/**/*.md', type: 'spec', strategy: 'markdown-heading' },
      { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
    ],
    embedding: config,
    lanceDir: `.lancedb-eval-${providerName}`,
    ignorePatterns: [
      '**/node_modules/**',
      '**/.lancedb/**',
      '**/dist/**',
      '**/__tests__/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
    ],
  });

  // Clean up any prior eval index
  const evalDbPath = path.join(PROJECT_ROOT, evalConfig.lanceDir);
  if (fs.existsSync(evalDbPath)) {
    fs.rmSync(evalDbPath, { recursive: true, force: true });
  }

  console.log(`\n[${providerName}] Syncing corpus...`);
  const syncStart = Date.now();

  await totem.runSync(evalConfig, {
    projectRoot: PROJECT_ROOT,
    incremental: false,
    onProgress: (msg: string) => console.log(`  [${providerName}] ${msg}`),
  });

  const syncDurationMs = Date.now() - syncStart;
  console.log(`[${providerName}] Sync complete in ${(syncDurationMs / 1000).toFixed(1)}s`);

  // Connect for querying
  const embedder = totem.createEmbedder(evalConfig.embedding!);
  const store = new totem.LanceStore(evalDbPath, embedder, (msg: string) =>
    console.log(`  [${providerName}] WARN: ${msg}`),
  );
  await store.connect();

  // Run eval queries
  const queryResults = [];

  for (const eq of EVAL_QUERIES) {
    const results = await store.search({
      query: eq.query,
      typeFilter: eq.typeFilter as ContentType | undefined,
      maxResults: 10,
      hybrid: false, // Pure vector search for fair comparison
    });

    const top5 = results.slice(0, 5);
    const top10 = results.slice(0, 10);

    const matchedAt5 = eq.expectedMatches.filter((expected) =>
      top5.some((r) => r.filePath.includes(expected) || r.label.includes(expected)),
    );
    const matchedAt10 = eq.expectedMatches.filter((expected) =>
      top10.some((r) => r.filePath.includes(expected) || r.label.includes(expected)),
    );
    const missed = eq.expectedMatches.filter(
      (expected) => !top10.some((r) => r.filePath.includes(expected) || r.label.includes(expected)),
    );

    queryResults.push({
      query: eq.query,
      description: eq.description,
      recallAt5: matchedAt5.length / eq.expectedMatches.length,
      recallAt10: matchedAt10.length / eq.expectedMatches.length,
      topResults: results.slice(0, 5).map((r) => ({
        label: r.label,
        filePath: r.filePath,
        score: r.score,
      })),
      matchedAt5,
      matchedAt10,
      missed,
    });
  }

  const avgRecallAt5 = queryResults.reduce((sum, q) => sum + q.recallAt5, 0) / queryResults.length;
  const avgRecallAt10 =
    queryResults.reduce((sum, q) => sum + q.recallAt10, 0) / queryResults.length;

  // Clean up eval index
  fs.rmSync(evalDbPath, { recursive: true, force: true });

  return {
    provider: providerName,
    queries: queryResults,
    avgRecallAt5,
    avgRecallAt10,
    syncDurationMs,
  };
}

// ─── Report ────────────────────────────────────────────

function printReport(results: ProviderResult[]) {
  console.log('\n' + '═'.repeat(72));
  console.log('  EMBEDDING RETRIEVAL QUALITY EVALUATION');
  console.log('═'.repeat(72));
  console.log(`  Corpus: Totem codebase + lessons | Queries: ${EVAL_QUERIES.length}`);
  console.log('─'.repeat(72));

  // Summary table
  console.log('\n  Provider          Recall@5    Recall@10   Sync Time');
  console.log('  ' + '─'.repeat(56));
  for (const r of results) {
    console.log(
      `  ${r.provider.padEnd(18)}` +
        `${(r.avgRecallAt5 * 100).toFixed(1).padStart(6)}%     ` +
        `${(r.avgRecallAt10 * 100).toFixed(1).padStart(6)}%     ` +
        `${(r.syncDurationMs / 1000).toFixed(1)}s`,
    );
  }

  // Per-query detail
  for (const r of results) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`  ${r.provider.toUpperCase()} — Per-Query Detail`);
    console.log('─'.repeat(72));

    for (const q of r.queries) {
      const icon = q.recallAt5 === 1 ? '✓' : q.recallAt10 === 1 ? '~' : '✗';
      console.log(
        `  ${icon} ${q.description.padEnd(42)} ` +
          `R@5=${(q.recallAt5 * 100).toFixed(0).padStart(3)}%  ` +
          `R@10=${(q.recallAt10 * 100).toFixed(0).padStart(3)}%`,
      );
      if (q.missed.length > 0) {
        console.log(`    missed: ${q.missed.join(', ')}`);
      }
    }
  }

  // Comparison (if multiple providers)
  if (results.length >= 2) {
    console.log(`\n${'═'.repeat(72)}`);
    console.log('  HEAD-TO-HEAD COMPARISON');
    console.log('═'.repeat(72));

    const [a, b] = results;
    const diff5 = ((a!.avgRecallAt5 - b!.avgRecallAt5) * 100).toFixed(1);
    const diff10 = ((a!.avgRecallAt10 - b!.avgRecallAt10) * 100).toFixed(1);

    console.log(
      `  Recall@5 delta:  ${a!.provider} ${Number(diff5) >= 0 ? '+' : ''}${diff5}pp vs ${b!.provider}`,
    );
    console.log(
      `  Recall@10 delta: ${a!.provider} ${Number(diff10) >= 0 ? '+' : ''}${diff10}pp vs ${b!.provider}`,
    );

    // Per-query wins
    let aWins = 0,
      bWins = 0,
      ties = 0;
    for (let i = 0; i < EVAL_QUERIES.length; i++) {
      const aScore = a!.queries[i]!.recallAt5;
      const bScore = b!.queries[i]!.recallAt5;
      if (aScore > bScore) aWins++;
      else if (bScore > aScore) bWins++;
      else ties++;
    }
    console.log(
      `  Query wins (R@5): ${a!.provider}=${aWins}  ${b!.provider}=${bWins}  ties=${ties}`,
    );
  }

  console.log('\n' + '═'.repeat(72));
}

// ─── Main ──────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const providerArg = args.find((a) => a.startsWith('--provider='))?.split('=')[1];

  const providers: { name: string; config: Record<string, unknown> }[] = [];

  const hasOpenAI = !!process.env['OPENAI_API_KEY'];
  const hasGemini = !!(process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY']);

  if (providerArg) {
    // Single-provider mode
    if (providerArg === 'openai' && !hasOpenAI) {
      console.error('OPENAI_API_KEY not set');
      process.exit(1);
    }
    if (providerArg === 'gemini' && !hasGemini) {
      console.error('GEMINI_API_KEY not set');
      process.exit(1);
    }
    if (providerArg === 'openai') {
      providers.push({
        name: 'openai',
        config: { provider: 'openai', model: 'text-embedding-3-small' },
      });
    } else if (providerArg === 'gemini') {
      providers.push({
        name: 'gemini',
        config: { provider: 'gemini', model: 'text-embedding-004' },
      });
    } else {
      console.error(`Unknown provider: ${providerArg}. Use 'openai' or 'gemini'.`);
      process.exit(1);
    }
  } else {
    // Comparison mode — run all available providers
    if (hasOpenAI) {
      providers.push({
        name: 'openai',
        config: { provider: 'openai', model: 'text-embedding-3-small' },
      });
    }
    if (hasGemini) {
      providers.push({
        name: 'gemini',
        config: { provider: 'gemini', model: 'text-embedding-004' },
      });
    }
    if (providers.length === 0) {
      console.error('No API keys found. Set OPENAI_API_KEY and/or GEMINI_API_KEY to run the eval.');
      process.exit(1);
    }
    if (providers.length === 1) {
      console.log(
        `Only ${providers[0]!.name} key found. Set both OPENAI_API_KEY and GEMINI_API_KEY for a comparison.`,
      );
    }
  }

  const results: ProviderResult[] = [];

  for (const p of providers) {
    const result = await evalProvider(p.name, p.config);
    results.push(result);
  }

  printReport(results);
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
