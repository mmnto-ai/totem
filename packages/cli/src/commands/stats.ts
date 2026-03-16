import * as path from 'node:path';

import { createEmbedder, LanceStore } from '@mmnto/totem';

import { loadConfig, loadEnv, requireEmbedding, resolveConfigPath } from '../utils.js';

export async function statsCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  const { totalChunks, byType } = await store.stats();

  console.log(`[Totem] Index statistics:`);
  console.log(`  Total chunks: ${totalChunks}`);
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }

  if (totalChunks === 0) {
    console.log('\n  No data indexed yet. Run `totem sync` first.');
  }

  // ─── Trap Ledger ──────────────────────────────────
  const totemDir = path.join(cwd, config.totemDir);
  const { loadCompiledRules, loadRuleMetrics } = await import('@mmnto/totem');
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const rules = loadCompiledRules(rulesPath);
  const metrics = loadRuleMetrics(totemDir);

  if (rules.length === 0) return;

  const TAG = 'Stats';
  const { log } = await import('../ui.js');
  const rulesByHash = new Map(rules.map((r) => [r.lessonHash, r]));

  // Aggregate totals
  const totalTriggers = Object.values(metrics.rules).reduce((s, m) => s + m.triggerCount, 0);
  const totalSuppressions = Object.values(metrics.rules).reduce((s, m) => s + m.suppressCount, 0);
  const totalPrevented = totalTriggers + totalSuppressions;

  log.info(TAG, `Compiled rules: ${rules.length}`);
  log.info(TAG, `Total violations prevented: ${totalPrevented}`);
  log.info(TAG, `  Blocked by rules: ${totalTriggers}`);
  log.info(TAG, `  Suppressed (acknowledged): ${totalSuppressions}`);

  // Category breakdown
  const byCategory: Record<string, { triggers: number; suppressions: number }> = {};
  for (const [hash, m] of Object.entries(metrics.rules)) {
    const rule = rulesByHash.get(hash);
    const cat = rule?.category ?? 'architecture';
    if (!byCategory[cat]) byCategory[cat] = { triggers: 0, suppressions: 0 };
    byCategory[cat].triggers += m.triggerCount;
    byCategory[cat].suppressions += m.suppressCount;
  }

  if (Object.keys(byCategory).length > 0) {
    log.info(TAG, 'By category:');
    for (const [cat, counts] of Object.entries(byCategory).sort(
      ([, a], [, b]) => b.triggers + b.suppressions - (a.triggers + a.suppressions),
    )) {
      const total = counts.triggers + counts.suppressions;
      if (total > 0) {
        log.dim(
          TAG,
          `  ${cat}: ${total} prevented (${counts.triggers} blocked, ${counts.suppressions} suppressed)`,
        );
      }
    }
  }

  // Top prevented rules (the Trap Ledger headline)
  const sorted = Object.entries(metrics.rules)
    .filter(([, m]) => m.triggerCount > 0 || m.suppressCount > 0)
    .sort(([, a], [, b]) => b.triggerCount + b.suppressCount - (a.triggerCount + a.suppressCount))
    .slice(0, 10);

  if (sorted.length > 0) {
    log.info(TAG, 'Top prevented violations:');
    for (const [hash, m] of sorted) {
      const rule = rulesByHash.get(hash);
      const cat = rule?.category ?? 'architecture';
      const label = rule ? rule.message.slice(0, 55) : hash;
      const total = m.triggerCount + m.suppressCount;
      log.dim(TAG, `  [${cat}] ${label} — ${total}x`);
    }
  }
}
