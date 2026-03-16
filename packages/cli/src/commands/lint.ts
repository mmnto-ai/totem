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
  const { extractChangedFiles, getDefaultBranch, getGitBranchDiff, getGitDiff } =
    await import('../git.js');
  const { log } = await import('../ui.js');
  const { runCompiledRules } = await import('./run-compiled-rules.js');

  const TAG = 'Lint';
  const format: ShieldFormat = options.format ?? 'text';
  const VALID_FORMATS: ShieldFormat[] = ['text', 'sarif', 'json'];
  if (!VALID_FORMATS.includes(format)) {
    throw new Error(`[Totem Error] Invalid --format "${format}". Use "text", "sarif", or "json".`);
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff
  const mode = options.staged ? 'staged' : 'all';
  log.info(TAG, `Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  let diff = getGitDiff(mode, cwd);

  if (!diff.trim()) {
    const base = getDefaultBranch(cwd);
    log.dim(TAG, `No uncommitted changes. Falling back to branch diff (${base}...HEAD)...`);
    diff = getGitBranchDiff(cwd, base);
  }

  if (!diff.trim()) {
    log.warn(TAG, 'No changes detected. Nothing to lint.');
    return;
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(TAG, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  const exportPaths = config.exports ? Object.values(config.exports) : undefined;

  await runCompiledRules({
    diff,
    cwd,
    totemDir: config.totemDir,
    format,
    outPath: options.out,
    exportPaths,
    ignorePatterns: [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])],
    tag: TAG,
  });
}
