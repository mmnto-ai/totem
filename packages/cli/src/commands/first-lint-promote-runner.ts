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
    sanitizeForTerminal,
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

  // Resolve the repo root eagerly (only after we know there's pending work)
  // so the .totemignore + manifest-exclusion paths can be computed relative
  // to it. Monorepo subpackages run lint with `cwd` and `configRoot` inside
  // the package, but `git ls-files` returns paths relative to the actual
  // repo root — so the manifest-exclusion set must use the same base or
  // the manifest entry won't match and Stage 4 will end up scanning the
  // compiled-rules file (false-positive matches against rules' own
  // `badExample` text).
  // totem-context: log+exitCode rather than throw per `.gemini/styleguide.md`
  // CLI-failure-signal rule (GCA mmnto-ai/totem#1787 R1) — git missing or
  // running outside a repo should not surface a stack trace.
  let repoRoot: string;
  try {
    repoRoot = safeExec('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      env: { ...process.env, LC_ALL: 'C' },
    }); // totem-context: intentional cleanup — CLI rejects throw at top-level per `.gemini/styleguide.md`; log+exitCode is the documented signal path
  } catch (err) {
    log.error(
      'Totem Error',
      `Failed to resolve git root: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return;
  }

  // `.totem/verification-outcomes.json` is committable, so once tracked it
  // surfaces in the tracked-files enumeration. Without an exclusion entry,
  // a pending rule would Stage-4 match against serialized outcome JSON
  // instead of consumer source files. Same class as the manifest-exclusion
  // (CR mmnto-ai/totem#1787 R1).
  const activeManifestPath = path.relative(repoRoot, manifestPath).replace(/\\/g, '/');
  const activeOutcomesPath = path.relative(repoRoot, outcomesPath).replace(/\\/g, '/');
  const manifestExclusionSet = new Set<string>([
    ...STAGE4_MANIFEST_EXCLUSIONS,
    activeManifestPath,
    activeOutcomesPath,
  ]);

  // `.totemignore` lives at the repo root by convention (matches compile.ts:708).
  // Resolving from `cwd` would miss the file when totem is run from a subpackage.
  const ignorePath = path.join(repoRoot, '.totemignore');
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

  let filesCache: readonly string[] | undefined;
  const readFileCache = new Map<string, Promise<string>>();

  const verifier = async (rule: import('@mmnto/totem').CompiledRule) => {
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
    // totem-context: msg composed from untrusted lessonHeading + verifier
    // error text in first-lint-promote.ts; sanitize before terminal write
    // (CR mmnto-ai/totem#1787 R1, terminal-injection guideline).
    onWarn: (msg: string) => log.warn(tag, sanitizeForTerminal(msg)),
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
