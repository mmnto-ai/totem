import type { ContentType } from '@mmnto/totem';

export async function searchCommand(
  query: string,
  options: { type?: string; maxResults?: string },
): Promise<void> {
  const path = await import('node:path');
  const { ContentTypeSchema, createEmbedder, LanceStore, TotemConfigError } =
    await import('@mmnto/totem');
  const { loadConfig, loadEnv, requireEmbedding, resolveConfigPath, sanitize } =
    await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder, {
    absolutePathRoot: cwd,
  });
  await store.connect();

  const VALID_TYPES = ContentTypeSchema.options;
  if (options.type && !VALID_TYPES.includes(options.type as ContentType)) {
    throw new TotemConfigError(
      `Invalid type filter: '${options.type}'. Valid types are: ${VALID_TYPES.join(', ')}`,
      'Check `totem search --help` for valid --type options.',
      'CONFIG_INVALID',
    );
  }

  const results = await store.search({
    query,
    typeFilter: options.type as ContentType | undefined,
    maxResults: options.maxResults ? parseInt(options.maxResults, 10) || 5 : 5,
  });

  if (results.length === 0) {
    console.log('[Totem] No results found.');
    return;
  }

  for (const result of results) {
    console.log(`\n--- ${sanitize(result.label).replace(/\n/g, ' ')} (${result.type}) ---`);
    console.log(
      `File: ${sanitize(result.filePath).replace(/\n/g, ' ')} | Score: ${result.score.toFixed(3)}`,
    );
    const snippet = result.content.slice(0, 200) + (result.content.length > 200 ? '...' : '');
    console.log(sanitize(snippet));
  }
}
