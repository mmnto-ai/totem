import { TotemConfigError } from '@mmnto/totem';

import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
  prComment?: number;
}

// ─── Command ────────────────────────────────────────

export async function lintCommand(options: LintOptions): Promise<void> {
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  const { getDiffForReview } = await import('../git.js');
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

  const result = await getDiffForReview(options, config, cwd, TAG);
  if (!result) return;

  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const exportPaths = config.exports ? Object.values(config.exports) : undefined;

  const startTime = Date.now();
  const { violations, rules } = await runCompiledRules({
    diff: result.diff,
    cwd,
    totemDir: config.totemDir,
    format,
    outPath: options.out,
    exportPaths,
    ignorePatterns: allIgnore,
    tag: TAG,
  });

  // Post PR comment if requested (zero-API-keys invariant: only behind --pr-comment flag)
  // Auto-infer PR number from GitHub Actions event payload if --pr-comment is passed without a value
  const prNumber =
    options.prComment ??
    (process.env.GITHUB_EVENT_NAME === 'pull_request'
      ? parseInt(process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)/)?.[1] ?? '', 10) || undefined
      : undefined);

  if (prNumber) {
    const { log } = await import('../ui.js');
    const { getHeadSha } = await import('@mmnto/totem');
    const { postPRComment } = await import('../pr-comment.js');

    const commitSha = getHeadSha(cwd) ?? 'unknown';
    const durationMs = Date.now() - startTime;

    try {
      await postPRComment({
        violations,
        rules,
        prNumber,
        commitSha,
        durationMs,
        cwd,
      });
      log.success(TAG, `PR comment updated on #${prNumber}`);
    } catch (err) {
      log.warn(
        TAG,
        `Failed to update PR comment: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
