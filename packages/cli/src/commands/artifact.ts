/**
 * `totem artifact rerun <hash>` / `totem artifact compare <a> <b>` — thin CLI
 * verbs over the run-artifact primitives (mmnto-ai/totem#2100, operator
 * ruling: verbs ship in-slice — sensors nobody can invoke don't get
 * dogfooded). JSON to stdout, no interactivity; the primitives carry all the
 * semantics (`services/run-artifacts.ts`).
 */

import * as path from 'node:path';

export async function artifactRerunCommand(hash: string): Promise<void> {
  const { log } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath, writeOutput } = await import('../utils.js');
  const { rerunArtifact } = await import('../services/run-artifacts.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);
  const configRoot = path.dirname(configPath);

  log.info('Artifact', `Rerunning ${hash.slice(0, 12)}… with its recorded bundle + backend...`);
  const result = await rerunArtifact({ hash, config, cwd, configRoot });
  writeOutput(
    JSON.stringify(
      { sourceHash: result.sourceHash, hash: result.hash, path: result.path },
      null,
      2,
    ),
  );
}

export async function artifactCompareCommand(hashA: string, hashB: string): Promise<void> {
  const { loadConfig, loadEnv, resolveConfigPath, writeOutput } = await import('../utils.js');
  const { compareArtifacts } = await import('../services/run-artifacts.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);
  const totemDirAbs = path.join(path.dirname(configPath), config.totemDir);

  writeOutput(JSON.stringify(compareArtifacts(totemDirAbs, hashA, hashB), null, 2));
}
