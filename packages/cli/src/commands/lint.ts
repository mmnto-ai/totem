import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
  /** PR number to post a comment on, or `true` to auto-infer from GitHub Actions env */
  prComment?: number | true;
}

// ─── Command ────────────────────────────────────────

export async function lintCommand(options: LintOptions): Promise<void> {
  const { TotemConfigError } = await import('@mmnto/totem');
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
  const path = await import('node:path');
  const configPath = resolveConfigPath(cwd);
  const configRoot = path.dirname(configPath);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Non-blocking staleness check — warn if compile manifest is stale
  try {
    const fs = await import('node:fs');
    const manifestPath = path.join(cwd, config.totemDir, 'compile-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const { readCompileManifest, generateInputHash } = await import('@mmnto/totem');
      const { log: uiLog } = await import('../ui.js');
      const manifest = readCompileManifest(manifestPath);
      const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
      const currentInputHash = generateInputHash(lessonsDir);
      if (currentInputHash !== manifest.input_hash) {
        uiLog.warn(
          TAG,
          "Compile manifest is stale — lessons changed since last compile. Run 'totem compile' to update.",
        );
      }
    }
  } catch {
    // Never crash lint due to staleness check — silently ignore errors
  }

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
    configRoot,
  });

  // Post PR comment if requested (zero-API-keys invariant: only behind --pr-comment flag)
  if (options.prComment == null) return;

  // Auto-infer PR number from GitHub Actions env if --pr-comment passed without a value
  const prNumber =
    options.prComment === true
      ? parseInt(process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)/)?.[1] ?? '', 10) || undefined
      : options.prComment;

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
