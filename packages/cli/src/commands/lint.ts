import { TotemConfigError } from '@mmnto/totem';

import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
}

// ─── Command ────────────────────────────────────────

export async function lintCommand(options: LintOptions): Promise<void> {
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  const {
    extractChangedFiles,
    filterDiffByPatterns,
    getDefaultBranch,
    getGitBranchDiff,
    getGitDiff,
  } = await import('../git.js');
  const { log } = await import('../ui.js');
  const { runCompiledRules } = await import('./run-compiled-rules.js');

  const TAG = 'Lint';
  const format: ShieldFormat = options.format ?? 'text';
  const VALID_FORMATS: ShieldFormat[] = ['text', 'sarif', 'json'];
  if (!VALID_FORMATS.includes(format)) {
    throw new TotemConfigError(
      `Invalid --format "${format}". Use "text", "sarif", or "json".`,
      'Check `totem lint --help` for valid options.',
      'CONFIG_INVALID',
    );
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff — filter ignored patterns before fallback check so that
  // noise (e.g., .strategy submodule pointer) doesn't suppress the branch diff.
  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const mode = options.staged ? 'staged' : 'all';
  log.info(TAG, `Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  let filteredDiff = await filterDiffByPatterns(getGitDiff(mode, cwd), allIgnore);

  if (!filteredDiff.trim()) {
    const base = getDefaultBranch(cwd);
    log.dim(TAG, `No relevant changes. Falling back to branch diff (${base}...HEAD)...`);
    filteredDiff = await filterDiffByPatterns(getGitBranchDiff(cwd, base), allIgnore);
  }

  if (!filteredDiff.trim()) {
    log.warn(TAG, 'No changes detected. Nothing to lint.');
    return;
  }

  const changedFiles = extractChangedFiles(filteredDiff);
  log.info(TAG, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  const exportPaths = config.exports ? Object.values(config.exports) : undefined;

  await runCompiledRules({
    diff: filteredDiff,
    cwd,
    totemDir: config.totemDir,
    format,
    outPath: options.out,
    exportPaths,
    ignorePatterns: allIgnore,
    tag: TAG,
  });
}
