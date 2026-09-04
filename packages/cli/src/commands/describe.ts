import type { ProjectDescription } from '@mmnto/totem';

export type { ProjectDescription } from '@mmnto/totem';

/**
 * The banner's rules line (mmnto-ai/totem#2765): the ACTIVE count leads — it is
 * the number lint enforces and status reports — and the inert split renders
 * only when it is non-trivial, so `Rules: 385 active of 485 compiled (93
 * archived, 7 untested-against-codebase)` on this repo and `Rules: 12 active`
 * on a repo with nothing inert. Never a bare "N compiled": that was the raw
 * total posing as the enforced set.
 */
export function formatRulesLine(
  d: Pick<
    ProjectDescription,
    'rules' | 'rulesCompiled' | 'rulesArchived' | 'rulesUntested' | 'rulesPendingVerification'
  >,
): string {
  const inert: string[] = [];
  if (d.rulesArchived > 0) inert.push(`${d.rulesArchived} archived`);
  if (d.rulesUntested > 0) inert.push(`${d.rulesUntested} untested-against-codebase`);
  if (d.rulesPendingVerification > 0) {
    inert.push(`${d.rulesPendingVerification} pending-verification`);
  }
  return inert.length === 0
    ? `Rules: ${d.rules} active`
    : `Rules: ${d.rules} active of ${d.rulesCompiled} compiled (${inert.join(', ')})`;
}

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
  log.info('[Describe]', formatRulesLine(result));
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
