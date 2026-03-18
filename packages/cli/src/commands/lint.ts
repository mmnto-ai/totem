import { TotemConfigError } from '@mmnto/totem';

import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
}

// ─── Command ────────────────────────────────────────

/**
 * Filter a unified diff to exclude files matching any of the given patterns.
 * Splits on `diff --git` boundaries and removes sections for ignored files.
 * Supports: exact paths (.strategy), directory globs (dir/**), extension globs (** /*.ext).
 */
function filterDiffByPatterns(diff: string, patterns: string[]): string {
  if (patterns.length === 0) return diff;

  const sections = diff.split(/^(?=diff --git )/m);
  return sections
    .filter((section) => {
      const match = section.match(/^diff --git a\/(.+?) b\//);
      if (!match) return true;
      const filePath = match[1]!;

      return !patterns.some((p) => {
        // Exact match: .strategy
        if (!p.includes('*')) return filePath === p || filePath.startsWith(p + '/');
        // Directory glob: dir/** or dir/**/*.ext
        const dirPrefix = p.split('**')[0]!.replace(/\/$/, '');
        if (dirPrefix && filePath.startsWith(dirPrefix)) return true;
        return false;
      });
    })
    .join('');
}

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

  // Filter diff to exclude shieldIgnorePatterns (e.g., .strategy submodule)
  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const filteredDiff = filterDiffByPatterns(diff, allIgnore);

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
