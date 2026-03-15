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

  // Rule observability metrics
  const totemDir = path.join(cwd, config.totemDir);
  const { loadCompiledRules, loadRuleMetrics } = await import('@mmnto/totem');
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const rules = loadCompiledRules(rulesPath);
  const metrics = loadRuleMetrics(totemDir);

  if (rules.length > 0) {
    const tracked = Object.keys(metrics.rules).length;
    const totalTriggers = Object.values(metrics.rules).reduce((s, m) => s + m.triggerCount, 0);
    const totalSuppressions = Object.values(metrics.rules).reduce((s, m) => s + m.suppressCount, 0);

    const TAG = 'Stats';
    const { log } = await import('../ui.js');
    log.info(TAG, `Compiled rules: ${rules.length}`);
    log.info(TAG, `Rules with metrics: ${tracked}`);
    log.info(TAG, `Total triggers: ${totalTriggers}`);
    log.info(TAG, `Total suppressions: ${totalSuppressions}`);

    // Show top triggered rules
    const sorted = Object.entries(metrics.rules)
      .filter(([, m]) => m.triggerCount > 0 || m.suppressCount > 0)
      .sort(([, a], [, b]) => b.triggerCount + b.suppressCount - (a.triggerCount + a.suppressCount))
      .slice(0, 5);

    if (sorted.length > 0) {
      const rulesByHash = new Map(rules.map((r) => [r.lessonHash, r]));
      log.info(TAG, 'Most active rules:');
      for (const [hash, m] of sorted) {
        const rule = rulesByHash.get(hash);
        const label = rule ? rule.message.slice(0, 60) : hash;
        log.dim(TAG, `  ${label} — triggers: ${m.triggerCount}, suppressions: ${m.suppressCount}`);
      }
    }
  }
}
