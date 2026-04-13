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
  const { log } = await import('../ui.js');

  const TAG = 'Search';

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

  const maxResults = options.maxResults ? parseInt(options.maxResults, 10) || 5 : 5;

  // Federation: connect to linked indexes (cross-repo mesh)
  const linkedStores: Array<{ store: InstanceType<typeof LanceStore>; linkName: string }> = [];
  if (config.linkedIndexes && config.linkedIndexes.length > 0) {
    for (const linkedPath of config.linkedIndexes) {
      try {
        const resolvedPath = path.resolve(cwd, linkedPath);
        const linkedConfigPath = resolveConfigPath(resolvedPath);
        const linkedConfig = await loadConfig(linkedConfigPath);
        const linkedEmbedding = linkedConfig.embedding;
        if (!linkedEmbedding) continue;
        const linkedEmbedder = createEmbedder(linkedEmbedding);
        const linkName = path.basename(resolvedPath).replace(/^\./, '');
        const linkedStore = new LanceStore(
          path.join(resolvedPath, linkedConfig.lanceDir),
          linkedEmbedder,
          { sourceRepo: linkName, absolutePathRoot: resolvedPath },
        );
        await linkedStore.connect();
        linkedStores.push({ store: linkedStore, linkName });
        log.dim(TAG, `Linked index: ${linkedPath}`);
      } catch (err) {
        log.warn(
          TAG,
          `Could not connect to linked index at ${linkedPath} - skipping. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

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
    maxResults,
  });

  // Query linked stores in parallel
  const linkedResults: Array<{
    result: (typeof results)[number];
    linkName: string;
  }> = [];
  if (linkedStores.length > 0) {
    const linkedSearches = await Promise.all(
      linkedStores.map(async ({ store: ls, linkName }) => {
        try {
          const r = await ls.search({
            query,
            typeFilter: options.type as ContentType | undefined,
            maxResults,
          });
          return r.map((result) => ({ result, linkName }));
        } catch (err) {
          log.warn(
            TAG,
            `Linked search failed for ${linkName} - skipping. ${err instanceof Error ? err.message : String(err)}`,
          );
          return [];
        }
      }),
    );
    linkedResults.push(...linkedSearches.flat());
  }

  // Merge primary and linked results, sort by score descending
  const allResults = [
    ...results.map((r) => ({ result: r, linkName: undefined as string | undefined })),
    ...linkedResults,
  ].sort((a, b) => b.result.score - a.result.score);

  if (allResults.length === 0) {
    console.log('[Totem] No results found.');
    return;
  }

  for (const { result, linkName } of allResults) {
    const repoTag = linkName ? `[${linkName}] ` : '';
    const label = repoTag + sanitize(result.label).replace(/\n/g, ' ');
    console.log(`\n--- ${label} (${result.type}) ---`);
    console.log(
      `File: ${sanitize(result.filePath).replace(/\n/g, ' ')} | Score: ${result.score.toFixed(3)}`,
    );
    const snippet = result.content.slice(0, 200) + (result.content.length > 200 ? '...' : '');
    console.log(sanitize(snippet));
  }
}
