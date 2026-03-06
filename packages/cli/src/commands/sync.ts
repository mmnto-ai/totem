import { runSync } from '@mmnto/totem';

import { createSpinner, log } from '../ui.js';
import { loadConfig, loadEnv, resolveConfigPath } from '../utils.js';

const TAG = 'Sync';

export async function syncCommand(options: { full?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  const incremental = !options.full;

  const spinner = await createSpinner(
    TAG,
    incremental ? 'Incremental sync...' : 'Full re-index...',
  );

  try {
    const result = await runSync(config, {
      projectRoot: cwd,
      incremental,
      onProgress: (msg) => spinner.update(msg),
    });

    spinner.succeed(`Done: ${result.chunksProcessed} chunks from ${result.filesProcessed} files`);
  } catch (err) {
    spinner.fail('Sync failed');
    throw err;
  }
}
