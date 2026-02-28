import * as path from 'node:path';
import { LanceStore, createEmbedder, ContentTypeSchema } from '@mmnto/totem';
import type { ContentType } from '@mmnto/totem';
import { loadEnv, loadConfig, resolveConfigPath } from '../utils.js';

export async function searchCommand(
  query: string,
  options: { type?: string; maxResults?: string },
): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  const VALID_TYPES = ContentTypeSchema.options;
  if (options.type && !VALID_TYPES.includes(options.type as ContentType)) {
    throw new Error(
      `[Totem Error] Invalid type filter: '${options.type}'. Valid types are: ${VALID_TYPES.join(', ')}`,
    );
  }

  const results = await store.search({
    query,
    typeFilter: options.type as ContentType | undefined,
    maxResults: options.maxResults ? parseInt(options.maxResults, 10) : 5,
  });

  if (results.length === 0) {
    console.log('[Totem] No results found.');
    return;
  }

  for (const result of results) {
    console.log(`\n--- ${result.label} (${result.type}) ---`);
    console.log(`File: ${result.filePath} | Score: ${result.score.toFixed(3)}`);
    console.log(result.content.slice(0, 200) + (result.content.length > 200 ? '...' : ''));
  }
}
