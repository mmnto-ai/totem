import { runSync } from '@mmnto/totem';
import { loadEnv, loadConfig, resolveConfigPath } from '../utils.js';

export async function syncCommand(options: { full?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  const incremental = !options.full;

  const result = await runSync(config, {
    projectRoot: cwd,
    incremental,
    onProgress: (msg) => console.log(`[Totem] ${msg}`),
  });

  console.log(
    `[Totem] Done: ${result.chunksProcessed} chunks from ${result.filesProcessed} files`,
  );
}
