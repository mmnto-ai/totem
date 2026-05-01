/**
 * CLI runner for the first-lint promotion interceptor (mmnto-ai/totem#1684 T5).
 *
 * Wires the Stage 4 verifier deps that core's `promotePendingRules` cannot
 * build itself — git ls-files enumeration, baseline resolution from the
 * consumer's `totem.config.ts` plus `.totemignore` directives, and the
 * fs-backed reader. Mutates `.totem/compiled-rules.json` in place when any
 * pending rule is promoted, and atomically writes
 * `.totem/verification-outcomes.json` for memoization across runs.
 *
 * Empty-pending fast path: when the manifest has zero `'pending-verification'`
 * rules, the function returns immediately without invoking git or reading
 * the outcomes file. The common-case lint pass pays no cost.
 */

import type { TotemConfig } from '@mmnto/totem';

const COMPILED_RULES_FILE = 'compiled-rules.json';
const VERIFICATION_OUTCOMES_FILE = 'verification-outcomes.json';

export interface RunFirstLintPromoteOptions {
  readonly cwd: string;
  readonly configRoot: string;
  readonly config: TotemConfig;
  readonly tag: string;
}

export async function runFirstLintPromote(options: RunFirstLintPromoteOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    loadCompiledRulesFile,
    parseStage4BaselineDirectives,
    promotePendingRules,
    resolveStage4Baseline,
    safeExec,
    saveCompiledRulesFile,
    STAGE4_MANIFEST_EXCLUSIONS,
    verifyAgainstCodebase,
  } = await import('@mmnto/totem');
  const { log } = await import('../ui.js');

  const { cwd, configRoot, config, tag } = options;
  const totemDirAbs = path.join(configRoot, config.totemDir);
  const manifestPath = path.join(totemDirAbs, COMPILED_RULES_FILE);
  const outcomesPath = path.join(totemDirAbs, VERIFICATION_OUTCOMES_FILE);

  if (!fs.existsSync(manifestPath)) return;

  // Read the unfiltered manifest so the interceptor can see pending rules.
  // `loadCompiledRules` (the lint-execution path) filters them out per
  // `compiler.ts:140`, so reading via the admin path is required.
  // A malformed manifest is not our concern to surface — the existing
  // runCompiledRules path will report it via loadCompiledRules's TotemParseError
  // immediately after this returns. Returning early here means a corrupt
  // manifest fails loud through the canonical lint error rather than a
  // confusing pre-lint stack trace.
  let manifest: import('@mmnto/totem').CompiledRulesFile;
  try {
    manifest = loadCompiledRulesFile(manifestPath); // totem-context: defer manifest-parse error to runCompiledRules's loadCompiledRules so the canonical lint error surfaces, not a pre-lint stack trace
  } catch {
    return;
  }
  const hasPending = manifest.rules.some((r) => r.status === 'pending-verification');
  if (!hasPending) return;

  // Per-process caches mirror the compile-side wiring in compile.ts:668.
  // We resolve the repo root + file list once and reuse them across rules.
  let repoRootCache: string | undefined;
  let filesCache: readonly string[] | undefined;

  const activeManifestPath = path.join(config.totemDir, COMPILED_RULES_FILE).replace(/\\/g, '/');
  const manifestExclusionSet = new Set<string>([...STAGE4_MANIFEST_EXCLUSIONS, activeManifestPath]);

  const ignorePath = path.join(cwd, '.totemignore');
  let ignoreContent = '';
  try {
    ignoreContent = await fs.promises.readFile(ignorePath, 'utf-8'); // totem-context: best-effort optional file; ENOENT means no directives — see the catch
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }
  const ignoreDirectives = parseStage4BaselineDirectives(ignoreContent);
  const configOverrides = config.review?.stage4Baseline;
  const baseline = resolveStage4Baseline({
    ignoreDirectives,
    configExtend: configOverrides?.extend,
    configExclude: configOverrides?.exclude,
  });

  const readFileCache = new Map<string, Promise<string>>();

  const verifier = async (rule: import('@mmnto/totem').CompiledRule) => {
    if (repoRootCache === undefined) {
      repoRootCache = safeExec('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        env: { ...process.env, LC_ALL: 'C' },
      });
    }
    const repoRoot = repoRootCache;
    if (filesCache === undefined) {
      const lsOutput: string = safeExec('git', ['ls-files', '-z', '--recurse-submodules'], {
        cwd: repoRoot,
        env: { ...process.env, LC_ALL: 'C' },
      });
      filesCache = lsOutput
        .split('\0')
        .filter((line) => line.length > 0 && !manifestExclusionSet.has(line));
    }
    return verifyAgainstCodebase(rule, baseline, {
      listFiles: async () => filesCache!,
      readFile: (file: string) => {
        let pending = readFileCache.get(file);
        if (!pending) {
          pending = fs.promises.readFile(path.join(repoRoot, file), 'utf-8');
          readFileCache.set(file, pending);
        }
        return pending;
      },
      workingDirectory: repoRoot,
    });
  };

  log.info(tag, 'Pack rules pending verification — running Stage 4 against your codebase...');
  const result = await promotePendingRules(manifest.rules, {
    outcomesPath,
    verifier,
    onWarn: (msg: string) => log.warn(tag, msg),
  });

  if (result.changed) {
    saveCompiledRulesFile(manifestPath, { ...manifest, rules: result.mutatedRules });
  }

  const summary =
    `Promoted ${result.promoted} pack rule(s) ` +
    `(${result.verifierInvocations} verified this pass, ` +
    `${result.verifierFailures} retried next time).`;
  log.success(tag, summary);
}
