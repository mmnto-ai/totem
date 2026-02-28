import * as path from 'node:path';
import { LanceStore, createEmbedder } from '@mmnto/totem';
import { loadEnv, loadConfig, resolveConfigPath } from '../utils.js';

export async function statsCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  const embedder = createEmbedder(config.embedding);
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
}
