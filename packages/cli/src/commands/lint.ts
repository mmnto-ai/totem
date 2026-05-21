import type { TimeoutMode } from '@mmnto/totem';

import type { ShieldFormat } from './shield.js';

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
  /** PR number to post a comment on, or `true` to auto-infer from GitHub Actions env */
  prComment?: number | true;
  /**
   * Bounded regex execution timeout mode (mmnto-ai/totem#1641). `strict`
   * (default) surfaces pattern-evaluation timeouts as lint errors.
   * `lenient` skips the timing-out rule-file pair with a warning and
   * does not contribute to the exit code.
   */
  timeoutMode?: TimeoutMode;
  /**
   * AST parse-failure mode (mmnto-ai/totem#1982). `strict` (default)
   * surfaces ast-grep / Tree-sitter parse errors as a non-zero exit.
   * `lenient` skips all AST rules for the run with a visible warning —
   * operator escape hatch for the gap until the per-file degrade in
   * mmnto-ai/totem#1786 ships. Env: `TOTEM_LINT_AST_PARSE_MODE`.
   */
  astParseMode?: TimeoutMode;
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

  // Engine boot (mmnto-ai/totem#1794). Pack-contributed languages, chunkers,
  // and grammars register here BEFORE any AST rule dispatch — see ADR-097
  // § 10. Idempotent within one Node process via isEngineSealed() so test
  // harnesses running multiple commands in sequence do not throw.
  const { bootstrapEngine } = await import('../utils/bootstrap-engine.js');
  await bootstrapEngine(config, configRoot);

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
          "Compile manifest is stale — lessons changed since last compile. Run 'totem lesson compile' to update.",
        );
      }
    }
  } catch {
    // Never crash lint due to staleness check — silently ignore errors
  }

  // First-lint promotion (mmnto-ai/totem#1684): scan the manifest for pack
  // rules in `'pending-verification'` state and run the Stage 4 verifier on
  // each, mutating compiled-rules.json + writing verification-outcomes.json.
  // No-op fast path returns immediately when nothing is pending.
  const { runFirstLintPromote } = await import('./first-lint-promote-runner.js');
  await runFirstLintPromote({ cwd, configRoot, config, tag: TAG });

  const result = await getDiffForReview(options, config, cwd, TAG);
  if (!result) return;

  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const exportPaths = config.exports ? Object.values(config.exports) : undefined;

  const timeoutMode: TimeoutMode = options.timeoutMode ?? 'strict';
  // mmnto-ai/totem#1982. CLI flag > env var > default 'strict'. The same
  // resolution happens inside runCompiledRules for the no-CLI-caller case
  // (test harness, programmatic use); the CLI-side resolution here is so
  // the strict-mode throw below can decide based on the same value.
  const astParseMode: TimeoutMode =
    options.astParseMode ??
    // totem-context: reading Node's process.env (cleaned by the runtime), not parsing a custom .env file; CRLF/quote-stripping rule doesn't apply.
    (process.env['TOTEM_LINT_AST_PARSE_MODE'] === 'lenient' ? 'lenient' : 'strict');

  const startTime = Date.now();
  const { violations, rules, regexTimeouts, astParseFailures } = await runCompiledRules({
    diff: result.diff,
    cwd,
    totemDir: config.totemDir,
    format,
    outPath: options.out,
    exportPaths,
    ignorePatterns: allIgnore,
    tag: TAG,
    configRoot,
    isStaged: !!options.staged,
    regexTimeoutMode: timeoutMode,
    astParseMode,
  });

  // mmnto-ai/totem#1641: strict mode surfaces any regex-evaluation timeout
  // as a non-zero exit. Lenient mode logged warnings inside runCompiledRules
  // and excludes timeouts from the exit code. The sub-shell CLI layer
  // throws a TotemError so the existing exit-code wiring picks it up.
  if (timeoutMode === 'strict' && regexTimeouts.length > 0) {
    const { TotemError } = await import('@mmnto/totem');
    const summary = regexTimeouts
      .map((t) => `${t.ruleHash} on ${t.file} (${t.elapsedMs}ms)`)
      .join('; ');
    throw new TotemError(
      'CHECK_FAILED',
      `Regex evaluation timed out on ${regexTimeouts.length} rule-file pair(s): ${summary}`,
      "Run with '--timeout-mode lenient' to skip timing-out rules, archive the offending rule via 'totem doctor --pr', or increase the timeout budget.",
    );
  }

  // mmnto-ai/totem#1982: parallel strict-mode throw for AST parse failures.
  // In strict mode the original TotemParseError already propagated from
  // runCompiledRules (this branch never runs); in lenient mode the failures
  // are recorded but exit stays clean. The strict branch here is defensive
  // — if we ever route through alternative codepaths that surface
  // astParseFailures without throwing, this preserves the exit-code contract.
  if (astParseMode === 'strict' && astParseFailures.length > 0) {
    const { TotemError } = await import('@mmnto/totem');
    const summary = astParseFailures
      .map((f) => `${f.language} on ${f.file}: ${f.message}`)
      .join('; ');
    throw new TotemError(
      'CHECK_FAILED',
      `AST parse failed on ${astParseFailures.length} target(s): ${summary}`,
      "Run with '--ast-parse-mode lenient' (or set TOTEM_LINT_AST_PARSE_MODE=lenient) to skip AST rules for this run. Track 'mmnto-ai/totem#1786' for the durable per-file graceful-degrade fix.",
    );
  }

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
