export type { ProjectDescription } from '@mmnto/totem';

export async function getProjectDescription(cwd: string) {
  const path = await import('node:path');
  const { describeProject } = await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const configPath = resolveConfigPath(cwd);
  const configRoot = path.dirname(configPath);
  const config = await loadConfig(configPath);

  return describeProject(config, configRoot);
}

export async function describeCommand(): Promise<void> {
  const { log } = await import('../ui.js');
  const { isJsonMode, printJson } = await import('../json-output.js');

  const cwd = process.cwd();
  const result = await getProjectDescription(cwd);

  if (isJsonMode()) {
    printJson({ status: 'success', command: 'describe', data: result });
    return;
  }

  log.info('[Describe]', `Project: ${result.project}`);
  if (result.description) log.info('[Describe]', `Description: ${result.description}`);
  log.info('[Describe]', `Tier: ${result.tier}`);
  log.info('[Describe]', `Rules: ${result.rules} compiled`);
  log.info('[Describe]', `Lessons: ${result.lessons}`);
  log.info('[Describe]', `Targets: ${result.targets.length}`);
  for (const t of result.targets) {
    log.info('[Describe]', `  ${t}`);
  }
  const partitionNames = Object.keys(result.partitions);
  if (partitionNames.length > 0) {
    log.info('[Describe]', `Partitions: ${partitionNames.join(', ')}`);
  }
  if (result.hooks.length > 0) {
    log.info('[Describe]', `Hooks: ${result.hooks.join(', ')}`);
  }
}
