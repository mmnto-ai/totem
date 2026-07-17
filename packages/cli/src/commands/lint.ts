import type { TimeoutMode } from '@mmnto/totem';

import type { LessonDelta, LessonFileStat, ProvenanceValue } from './lint-staleness.js';
import type { ShieldFormat } from './shield.js';

// ─── Staleness naming helpers (mmnto-ai/totem#2399) ─

/**
 * Timeout for each git spawn in the non-blocking staleness delta. Bounded so a
 * hung git can never stall the lint hot path — the whole check is advisory and
 * degrades to name-only / the generic line on any git failure.
 */
const STALENESS_GIT_TIMEOUT_MS = 5_000;

type FsModule = typeof import('node:fs');
type PathModule = typeof import('node:path');

/**
 * Recursively count `.md` files under `lessonsDir` (readdir only, never reads
 * file content) so the caller can gate provenance on corpus size. Returns 0
 * when the directory is unreadable — a safe floor that does not force the skip.
 */
function countLessonMdFiles(fs: FsModule, path: PathModule, lessonsDir: string): number {
  let entries: import('node:fs').Dirent[];
  try {
    entries = fs.readdirSync(lessonsDir, { withFileTypes: true });
    // totem-context: best-effort — an unreadable lessons dir yields 0 (does not force provenance-skip); this advisory-only count must never crash lint (mmnto-ai/totem#2399)
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countLessonMdFiles(fs, path, path.join(lessonsDir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      count += 1;
    }
  }
  return count;
}

/**
 * Walk `.md` files under `lessonsDir` and return each one's mtime (ms), keyed by
 * a lessons-dir-relative forward-slash path. Feeds the mtime fallback classifier
 * when git has no anchor. Best-effort: an unreadable subtree contributes nothing
 * rather than throwing.
 */
function walkLessonMtimes(fs: FsModule, path: PathModule, lessonsDir: string): LessonFileStat[] {
  const out: LessonFileStat[] = [];
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
      // totem-context: best-effort — an unreadable subtree is skipped so this advisory-only mtime walk never crashes lint (mmnto-ai/totem#2399)
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const rel = path.relative(lessonsDir, full).replace(/\\/g, '/');
          out.push({ path: rel, mtimeMs: fs.statSync(full).mtimeMs });
          // totem-context: best-effort — an unstattable file is omitted so this advisory-only mtime walk never crashes lint (mmnto-ai/totem#2399)
        } catch {
          continue;
        }
      }
    }
  };
  walk(lessonsDir);
  return out;
}

// ─── Types ──────────────────────────────────────────

export interface LintOptions {
  out?: string;
  format?: ShieldFormat;
  staged?: boolean;
  /**
   * Force the branch-vs-base (push-gate) diff scope (mmnto-ai/totem#2091).
   * Mutually exclusive with `staged`.
   */
  branch?: boolean;
  /**
   * Explicit base branch name for the forced branch-vs-base scope
   * (mmnto-ai/totem#2091). Implies `branch`; resolved via `getGitBranchDiff`'s
   * origin-preference logic (mmnto-ai/totem#2054).
   */
  base?: string;
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

  // Non-blocking staleness check — warn if compile manifest is stale, and NAME
  // the delta (which lessons changed/added/removed since last compile, with
  // last-commit provenance) so the advisory is actionable (mmnto-ai/totem#2399).
  try {
    const fs = await import('node:fs');
    const manifestPath = path.join(cwd, config.totemDir, 'compile-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const { readCompileManifest, generateInputHash, safeExec, findRepoRootSync } =
        await import('@mmnto/totem');
      const { log: uiLog } = await import('../ui.js');
      const {
        STALE_LESSON_NAME_CAP,
        PROVENANCE_LESSON_FILE_CAP,
        UNTRACKED_PROVENANCE,
        parseLessonNameStatus,
        classifyLessonsByMtime,
        formatStalenessWarning,
      } = await import('./lint-staleness.js');

      const manifest = readCompileManifest(manifestPath);
      const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
      const currentInputHash = generateInputHash(lessonsDir, cwd);
      if (currentInputHash !== manifest.input_hash) {
        // Bounded best-effort: any git failure inside these helpers degrades to
        // the mtime fallback (or the generic line) rather than killing the warn.
        // The whole block stays inside the outer never-crash try/catch below.
        const toPosix = (p: string): string => p.replace(/\\/g, '/');
        const repoRoot = findRepoRootSync(cwd);

        // Primary: classify from a `--name-status` diff against the commit that
        // last wrote the manifest — the lesson drift since that anchor is exactly
        // what makes the aggregate input hash disagree.
        let delta: LessonDelta | null = null;
        let deltaFromGit = false;
        if (repoRoot) {
          const lessonsPrefix = toPosix(path.relative(repoRoot, lessonsDir));
          try {
            const anchor = safeExec(
              'git',
              ['log', '-1', '--format=%H', '--', toPosix(path.relative(repoRoot, manifestPath))],
              { cwd: repoRoot, timeout: STALENESS_GIT_TIMEOUT_MS },
            );
            if (anchor.length > 0 && lessonsPrefix.length > 0) {
              const nameStatus = safeExec(
                'git',
                ['diff', '--name-status', anchor, '--', lessonsPrefix],
                { cwd: repoRoot, timeout: STALENESS_GIT_TIMEOUT_MS },
              );
              delta = parseLessonNameStatus(nameStatus, lessonsPrefix);
              deltaFromGit = true;
            }
            // totem-context: best-effort — git unavailable/errored degrades to the mtime fallback below; this advisory-only naming must never crash lint (mmnto-ai/totem#2399)
          } catch {
            delta = null;
          }
        }

        // Fallback: name lessons whose mtime is after the manifest's compile
        // instant (no git anchor available). Every hit is reported as 'changed'.
        if (!deltaFromGit) {
          const compiledAtMs = Date.parse(manifest.compiled_at);
          delta = classifyLessonsByMtime(walkLessonMtimes(fs, path, lessonsDir), compiledAtMs);
        }

        const namedDelta = delta ?? { entries: [] };

        // Provenance only for the git-derived delta (its paths are repo-relative,
        // so a per-file `log -1` lookup resolves against repoRoot). Skipped
        // entirely on a very large lesson corpus (PROVENANCE_LESSON_FILE_CAP) so
        // the naming logic never paces the lint hot path.
        let provenance: Map<string, ProvenanceValue> | null = null;
        if (deltaFromGit && repoRoot && namedDelta.entries.length > 0) {
          if (countLessonMdFiles(fs, path, lessonsDir) <= PROVENANCE_LESSON_FILE_CAP) {
            provenance = new Map<string, ProvenanceValue>();
            for (const entry of namedDelta.entries.slice(0, STALE_LESSON_NAME_CAP)) {
              try {
                const out = safeExec('git', ['log', '-1', '--format=%h|%an', '--', entry.path], {
                  cwd: repoRoot,
                  timeout: STALENESS_GIT_TIMEOUT_MS,
                });
                if (out.length === 0) {
                  // No commit history — staged-but-uncommitted / untracked (mmnto-ai/totem#2113).
                  provenance.set(entry.path, UNTRACKED_PROVENANCE);
                  continue;
                }
                const sep = out.indexOf('|');
                const shortSha = sep === -1 ? out : out.slice(0, sep);
                const author = sep === -1 ? '' : out.slice(sep + 1);
                provenance.set(entry.path, { shortSha, author });
                // totem-context: best-effort — a per-file provenance lookup that errors leaves the entry unset (renders name-only); this advisory must never crash lint (mmnto-ai/totem#2399)
              } catch {
                provenance.delete(entry.path);
              }
            }
          }
        }

        uiLog.warn(
          TAG,
          formatStalenessWarning(namedDelta, {
            nameCap: STALE_LESSON_NAME_CAP,
            displayNameFor: (p) => path.basename(p),
            provenance,
          }),
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

  // `warnNarrowScope: true` is the lint-only opt-in for the narrow-scope
  // advisory (mmnto-ai/totem#2090) — review never sets it, so staged-slice
  // reviews stay warning-free.
  const result = await getDiffForReview({ ...options, warnNarrowScope: true }, config, cwd, TAG);
  if (!result) return;

  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];
  const exportPaths = config.exports ? Object.values(config.exports) : undefined;

  const timeoutMode: TimeoutMode = options.timeoutMode ?? 'strict';
  // mmnto-ai/totem#1982. CLI flag > env var > default 'strict'. Pre-resolved
  // here for symmetry with timeoutMode; runCompiledRules re-resolves
  // identically for the no-CLI-caller path (test harness, programmatic use).
  const astParseMode: TimeoutMode =
    options.astParseMode ??
    // totem-context: reading Node's process.env (cleaned by the runtime), not parsing a custom .env file; CRLF/quote-stripping rule doesn't apply.
    (process.env['TOTEM_LINT_AST_PARSE_MODE'] === 'lenient' ? 'lenient' : 'strict');

  const startTime = Date.now();
  const { violations, rules, regexTimeouts } = await runCompiledRules({
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

  // mmnto-ai/totem#1982: in strict mode the original TotemParseError already
  // propagated from runCompiledRules (see ast-grep-query.ts rethrow path),
  // carrying the AST_GREP_HINT which names --ast-parse-mode lenient as the
  // escape route. No parallel strict-mode throw needed at the lint.ts layer
  // — astParseFailures is only populated in lenient mode, by design.

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
