import type {
  CompiledRule,
  CompiledRulesFile,
  LayerTraceEvent,
  LessonInput,
  NonCompilableEntry,
  NonCompilableReasonCode,
} from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────

const TAG = 'Compile';
const COMPILED_RULES_FILE = 'compiled-rules.json';
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;
const CLOUD_CONCURRENCY = 50;

// ─── Types ──────────────────────────────────────────

/**
 * Terminal outcome of a `--upgrade <hash>` run, returned by `compileCommand`
 * so callers (like `totem doctor --pr` self-healing) can distinguish an actual
 * rule replacement from a noop / skipped / failed outcome and only report real
 * upgrades in their summaries.
 *
 * - `replaced`: compilation produced a fresh rule that replaced the stale copy
 * - `skipped`:  LLM decided the lesson is non-compilable; rule moved to
 *               nonCompilable and removed from active rules
 * - `noop`:     compile returned with no change (rare — cache hit path)
 * - `failed`:   transient error (network, rate limit, parser failure); old
 *               rule is preserved untouched
 */
export type UpgradeStatus = 'replaced' | 'skipped' | 'noop' | 'failed';

export interface UpgradeOutcome {
  hash: string;
  status: UpgradeStatus;
}

export interface CompileOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  force?: boolean;
  export?: boolean;
  fromCursor?: boolean;
  concurrency?: string;
  cloud?: string;
  verbose?: boolean;
  /**
   * Telemetry-driven re-compile (mmnto/totem#1131). Filters lessons to a single hash
   * (full or short prefix), bypasses the cache, and threads a non-code-ratio
   * directive into the Pipeline 2 system prompt.
   */
  upgrade?: string;
  /**
   * Working directory for this compile run (mmnto/totem#1232). Defaults to
   * `process.cwd()`. Pass an explicit path so callers like `runSelfHealing`
   * can target a project directory that differs from the process working
   * directory without relying on `process.chdir`.
   */
  cwd?: string;
  /**
   * Batch upgrade mode (mmnto/totem#1235). Used by `runSelfHealing` to avoid
   * redundant config/lesson/rules loads when upgrading N candidates. When set,
   * the single-hash `upgrade` path is skipped and all targets compile in a
   * single pass. Cannot be combined with `upgrade`, `cloud`, or `force`.
   */
  upgradeBatch?: Array<{
    hash: string;
    /** Telemetry directive to inject into the Pipeline 2 prompt for this lesson. */
    telemetryPrefix?: string;
  }>;
  /**
   * Recompute `compile-manifest.json`'s `output_hash` from the current
   * `compiled-rules.json` state without invoking the LLM or touching any
   * lessons (mmnto-ai/totem#1587). Exists to support the postmerge
   * inline-archive workflow where a curation script mutates
   * `status: 'archived'` on a rule directly; `--refresh-manifest` is the
   * blessed way to re-sync the manifest afterwards. Cannot combine with
   * `--force`.
   */
  refreshManifest?: boolean;
}

// ─── Telemetry directive (mmnto/totem#1131) ────────────────────

/**
 * Build the directive injected into the Sonnet system prompt for `--upgrade`.
 *
 * `unknown` is excluded from both the numerator and the denominator because it
 * holds historical / unclassified telemetry (pre-context-aware hits, or events
 * where the rule runner did not provide an `astContext`). Including it would
 * dilute the classified signal and produce misleading ratios.
 */
export function buildTelemetryPrefix(contextCounts: {
  code: number;
  string: number;
  comment: number;
  regex: number;
  unknown: number;
}): string {
  const classifiedTotal =
    contextCounts.code + contextCounts.string + contextCounts.comment + contextCounts.regex;
  const nonCode = contextCounts.string + contextCounts.comment + contextCounts.regex;
  const pct = classifiedTotal > 0 ? Math.round((nonCode / classifiedTotal) * 100) : 0;
  const unknownNote =
    contextCounts.unknown > 0
      ? ` Unclassified (historical) matches: ${contextCounts.unknown}.`
      : '';
  return [
    `This rule was flagged because ${pct}% of its classified matches occur in non-code contexts`,
    `(strings: ${contextCounts.string}, comments: ${contextCounts.comment}, regex literals: ${contextCounts.regex}). Please prefer an ast-grep`,
    `structural pattern that only matches executable code, not string or comment content.${unknownNote}`,
  ].join(' ');
}

// ─── Non-compilable cache helpers ───────────────────

/**
 * Value side of the in-memory `nonCompilableMap`. Carries the title plus the
 * machine-readable reasonCode (mmnto-ai/totem#1481) so prune / serialize
 * steps round-trip the full 4-tuple without a lookup.
 */
export interface NonCompilableMapValue {
  title: string;
  reasonCode: NonCompilableReasonCode;
  reason?: string;
}

/**
 * Filter stale entries from a non-compilable map against the current set of
 * lesson hashes. Returns the fresh 4-tuple list and a count of how many
 * entries were drained.
 *
 * Extracted for mmnto/totem#1281 so the no-op compile path can drain stale
 * entries too — previously the prune only ran when `toCompile.length > 0`,
 * leaving stale entries stranded on no-op runs (e.g. after a lesson was
 * removed or after a parser-bug fix invalidated old non-compilable hashes).
 * Pure function; does not mutate the input map.
 *
 * mmnto-ai/totem#1481: preserves `reasonCode` and `reason` through the
 * prune so ledger entries stay 4-tuple-shaped on disk. Dropping them back
 * to 2-tuple would silently reintroduce `'legacy-unknown'` on the next
 * load via the Read transform.
 */
export function pruneStaleNonCompilable(
  nonCompilableMap: Map<string, NonCompilableMapValue>,
  currentHashes: Set<string>,
): { fresh: NonCompilableEntry[]; drained: number } {
  const fresh: NonCompilableEntry[] = [];
  for (const [hash, value] of nonCompilableMap) {
    if (currentHashes.has(hash)) {
      const entry: NonCompilableEntry = {
        hash,
        title: value.title,
        reasonCode: value.reasonCode,
      };
      if (value.reason !== undefined) entry.reason = value.reason;
      fresh.push(entry);
    }
  }
  return { fresh, drained: nonCompilableMap.size - fresh.length };
}

/**
 * Filter stale compiled rules whose source lesson has been removed from the
 * project. Returns the fresh rule list (same object references preserved to
 * keep audit lineage intact) and a count of how many rules were dropped.
 *
 * Symmetrical counterpart to `pruneStaleNonCompilable` — both helpers are
 * used by the no-op compile path (mmnto/totem#1281) so lesson removals drain
 * the compiled rule AND any stale non-compilable entry in the same run.
 * Pure function; does not mutate the input array.
 */
export function pruneStaleRules(
  rules: readonly CompiledRule[],
  currentHashes: Set<string>,
): { fresh: CompiledRule[]; pruned: number } {
  const fresh = rules.filter((r) => currentHashes.has(r.lessonHash));
  return { fresh, pruned: rules.length - fresh.length };
}

/**
 * Replace-by-lessonHash if an entry with the same hash is already in the
 * array; otherwise append. Preserves array order for existing entries so
 * the compile loop's output stays stable across runs.
 *
 * Used by the --force durability path (mmnto-ai/totem#1587) and the
 * non-force add-new-rule path: all success-side pushes go through this
 * helper so transient compile failures leave old rules intact and
 * repeated successes do not double-insert.
 */
export function upsertRule(rules: CompiledRule[], rule: CompiledRule): void {
  const idx = rules.findIndex((r) => r.lessonHash === rule.lessonHash);
  if (idx >= 0) {
    rules[idx] = rule;
  } else {
    rules.push(rule);
  }
}

// ─── Verbose trace renderer (mmnto-ai/totem#1482) ──

/**
 * Map a numeric layer from a trace event to its pipeline label. Tolerates
 * unknown values so a future ADR-088 phase can introduce new layers without
 * breaking the renderer.
 */
function pipelineLabel(layer: number): string {
  switch (layer) {
    case 1:
      return 'Pipeline 1 (manual)';
    case 2:
      return 'Pipeline 2 (example-based)';
    case 3:
      return 'Pipeline 3 (LLM + verify-retry)';
    default:
      return `Layer ${layer}`;
  }
}

/**
 * Format a lesson's trace array into a single multi-line block for the
 * `--verbose` renderer. Returns a string (no trailing newline — caller
 * controls that). Output shape:
 *
 *   lesson-<hash8> "<heading>":
 *     Layer <N> (<pipeline label>) -> <outcome> (<patternHash?>)
 *       verify on example: <outcome>
 *       retry N: scheduled
 *     result: <status> (<reasonCode or detail>)
 *
 * The renderer is defensive: malformed / unknown layer numbers render as
 * "(unknown)" rather than throwing.
 */
export function formatVerboseTraceBlock(
  lesson: { heading: string; hash: string },
  status: 'compiled' | 'skipped' | 'failed' | 'noop',
  reasonCode: NonCompilableReasonCode | undefined,
  trace: readonly LayerTraceEvent[] | undefined,
): string {
  const lines: string[] = [];
  const shortHash = lesson.hash.slice(0, 8);
  lines.push(`lesson-${shortHash} "${lesson.heading}":`);

  if (!trace || trace.length === 0) {
    lines.push(`  (no trace events recorded)`);
    const resultSuffix = reasonCode ? ` (${reasonCode})` : '';
    lines.push('  result: ' + status + resultSuffix);
    return lines.join('\n');
  }

  // Separate events into prelude (generate / verify / retry) and terminal
  // (result). The terminal lives on its own line with full framing.
  let retryCounter = 0;
  let sawResult = false;
  for (const ev of trace) {
    const label = pipelineLabel(ev.layer);
    if (ev.action === 'generate') {
      const detail = ev.patternHash ? ` (patternHash=${ev.patternHash})` : '';
      lines.push(`  Layer ${ev.layer} (${label}) -> ` + ev.outcome + detail);
    } else if (ev.action === 'verify') {
      lines.push(`    verify on example: ${ev.outcome}`);
    } else if (ev.action === 'retry') {
      retryCounter++;
      lines.push(`    retry ${retryCounter}: ${ev.outcome}`);
    } else if (ev.action === 'result') {
      const detail = ev.reasonCode ? ` (${ev.reasonCode})` : '';
      lines.push('  result: ' + ev.outcome + detail);
      sawResult = true;
    } else {
      lines.push(`  (unknown) ${String(ev.action)}: ${String(ev.outcome)}`);
    }
  }

  // Defense in depth: if the trace somehow never emitted a terminal result
  // event, synthesize one from the caller-supplied `status` so the verbose
  // block always carries a final line. `compileLesson` pushes a result
  // event on every return path, but a future refactor could regress that;
  // this guard keeps the rendered block well-formed regardless. We use
  // `status` directly rather than the last event's outcome because that
  // outcome is an intermediate marker like 'MATCH' or 'attempt-1', not the
  // lesson's final state.
  if (!sawResult) {
    const resultSuffix = reasonCode ? ` (${reasonCode})` : '';
    lines.push('  result: ' + status + resultSuffix);
  }

  return lines.join('\n');
}

// ─── Logging helpers ────────────────────────────────

function logCompiledRule(
  log: { success: (tag: string, msg: string) => void },
  lesson: LessonInput,
  rule: CompiledRule,
): void {
  const engine = rule.engine;
  const severity = rule.severity ?? 'warning';
  if (engine === 'ast-grep') {
    log.success(
      TAG,
      `[${lesson.heading}] Compiled (ast-grep, ${severity}): ${rule.astGrepPattern}`,
    ); // totem-ignore
  } else if (engine === 'ast') {
    log.success(TAG, `[${lesson.heading}] Compiled (ast, ${severity}): ${rule.astQuery}`); // totem-ignore
  } else if (rule.manual === true || rule.lessonHeading === rule.message) {
    // Manual pattern — `manual: true` flag (post-mmnto/totem#1265) or legacy heading=message heuristic.
    // The legacy heuristic only worked when manual rules had no rich message; the explicit
    // flag is the reliable post-mmnto/totem#1265 signal.
    const manualEngine = rule.engine;
    log.success(
      TAG,
      `[${lesson.heading}] Compiled (manual ${manualEngine}, ${severity}): ${rule.pattern}`,
    ); // totem-ignore
  } else {
    log.success(TAG, `[${lesson.heading}] Compiled (regex, ${severity}): /${rule.pattern}/`); // totem-ignore
  }
}

// ─── Test fixture lookup (ADR-065) ──────────────────

function getTestedHashes(
  testsDir: string,
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
): Set<string> {
  const hashes = new Set<string>();
  try {
    if (!fs.existsSync(testsDir)) return hashes;
    for (const file of fs.readdirSync(testsDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
      const match = content.match(/^rule:\s*(\S+)/m);
      if (match) hashes.add(match[1]);
    }
  } catch {
    // tests dir unreadable
  }
  return hashes;
}

// ─── Auto-scaffold (ADR-065 / #854) ─────────────────

export interface AutoScaffoldDeps {
  fs: typeof import('node:fs');
  path: typeof import('node:path');
  testsDir: string;
  cwd: string;
  testedHashes: Set<string>;
  log: { info: (tag: string, msg: string) => void };
  extractRuleExamples: typeof import('@mmnto/totem').extractRuleExamples;
  deriveVirtualFilePath: typeof import('@mmnto/totem').deriveVirtualFilePath;
  scaffoldFixture: typeof import('@mmnto/totem').scaffoldFixture;
  scaffoldFixturePath: typeof import('@mmnto/totem').scaffoldFixturePath;
}

/** Returns true if the fixture was written, false on failure. */
export function autoScaffoldFixture(
  lesson: LessonInput,
  rule: CompiledRule,
  deps: AutoScaffoldDeps,
): boolean {
  try {
    const examples = deps.extractRuleExamples(lesson.body);
    const virtualPath = deps.deriveVirtualFilePath(rule);
    const content = deps.scaffoldFixture({
      ruleHash: lesson.hash,
      filePath: virtualPath,
      failLines: examples?.hits,
      passLines: examples?.misses,
      heading: lesson.heading,
    });
    const fixturePath = deps.scaffoldFixturePath(deps.testsDir, lesson.hash);
    deps.fs.mkdirSync(deps.path.dirname(fixturePath), { recursive: true });
    deps.fs.writeFileSync(fixturePath, content, { encoding: 'utf8', flag: 'wx' });
    deps.testedHashes.add(lesson.hash);
    deps.log.info(
      TAG,
      `[${lesson.heading}] Auto-scaffolded test fixture → ${deps.path.relative(deps.cwd, fixturePath)}`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log.info(TAG, `[${lesson.heading}] Failed to scaffold fixture (non-fatal): ${msg}`);
    return false;
  }
}

// ─── Main command ───────────────────────────────────

export async function compileCommand(
  options: CompileOptions,
): Promise<UpgradeOutcome | UpgradeOutcome[] | void> {
  const { TotemConfigError, TotemError } = await import('@mmnto/totem');
  const { COMPILER_SYSTEM_PROMPT, PIPELINE3_COMPILER_PROMPT } =
    await import('./compile-templates.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { log } = await import('../ui.js');
  const { isGlobalConfigPath, loadConfig, loadEnv, resolveConfigPath, runOrchestrator } =
    await import('../utils.js');
  const {
    buildCompiledRule,
    buildManualRule,
    compileLesson: compileLessonCore,
    deriveVirtualFilePath,
    exportLessons,
    extractManualPattern,
    extractRuleExamples,
    formatExampleFailure,
    generateInputHash,
    generateOutputHash,
    hashLesson,
    loadCompiledRulesFile,
    parseCompilerResponse,
    readAllLessons,
    readCompileManifest,
    saveCompiledRulesFile,
    scaffoldFixture,
    scaffoldFixturePath,
    verifyRuleExamples,
    writeCompileManifest,
  } = await import('@mmnto/totem');

  // Guard: throw a specific NO_LESSONS_DIR error instead of a generic
  // TotemParseError when lessonsDir is absent or is not a directory.
  // Called before both generateInputHash sites so both branches get the
  // same explicit error with the same recovery hint.
  const ensureLessonsDir = (dir: string): void => {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      throw new TotemError(
        'NO_LESSONS_DIR',
        `Lessons directory not found: ${dir}`,
        'Run `totem lesson extract <pr>` to create lessons, or create .totem/lessons/ manually.',
      );
    }
  };

  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd);
  if (isGlobalConfigPath(configPath)) {
    throw new TotemConfigError(
      'Cannot compile rules without a local project.',
      "Run 'totem init' to create a local .totem/ directory first.",
      'CONFIG_MISSING',
    );
  }
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, COMPILED_RULES_FILE);

  // ─── --refresh-manifest primitive (mmnto-ai/totem#1587) ─────────
  // No-LLM path that recomputes `output_hash` from current
  // `compiled-rules.json` state. Supports the postmerge inline-archive
  // workflow where a curation script mutates `status: 'archived'` on a
  // rule directly. Preflights the manifest read before any write
  // (mmnto-ai/totem#1601 CR pattern): missing/corrupt manifest fails
  // loud without side effects.
  if (options.refreshManifest) {
    if (options.force) {
      throw new TotemConfigError(
        '--refresh-manifest cannot be combined with --force.',
        '--refresh-manifest is a no-LLM primitive that only recomputes output_hash. Use one or the other, not both.',
        'CONFIG_INVALID',
      );
    }
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    if (!fs.existsSync(rulesPath)) {
      throw new TotemError(
        'NO_RULES',
        `No compiled-rules.json at ${rulesPath}.`,
        "Run 'totem lesson compile' first to generate the rules file.",
      );
    }
    // Validate compiled-rules.json by parsing it through the schema
    // BEFORE refreshing the manifest. Without this, a corrupt rules file
    // gets its new byte-level hash written to the manifest and
    // verify-manifest stops surfacing the corruption — silent drift.
    // loadCompiledRulesFile throws TotemParseError on malformed JSON or
    // schema violations (CR finding on PR mmnto-ai/totem#1629).
    const compiledRulesFile = loadCompiledRulesFile(rulesPath);
    const compileManifest = readCompileManifest(manifestPath);
    const freshOutputHash = generateOutputHash(rulesPath);
    if (compileManifest.output_hash === freshOutputHash) {
      log.info(TAG, 'Manifest already fresh — no changes.');
      return;
    }
    compileManifest.output_hash = freshOutputHash;
    compileManifest.compiled_at = new Date().toISOString();
    compileManifest.rule_count = compiledRulesFile.rules.length;
    writeCompileManifest(manifestPath, compileManifest);
    log.success(TAG, `Manifest refreshed: output_hash ${freshOutputHash.slice(0, 8)}…`);
    return;
  }

  const lessons = readAllLessons(totemDir);

  // Ingest cursor instructions if --from-cursor
  if (options.fromCursor) {
    const { scanCursorInstructions } = await import('@mmnto/totem');
    const cursorInstructions = scanCursorInstructions(cwd);
    if (cursorInstructions.length > 0) {
      log.info(TAG, `Found ${cursorInstructions.length} Cursor instruction(s)`); // totem-ignore
      for (const instr of cursorInstructions) {
        const body = instr.body + (instr.globs ? `\n\nFile scope: ${instr.globs.join(', ')}` : '');
        lessons.push({
          index: lessons.length,
          heading: `[cursor] ${instr.heading}`,
          tags: ['cursor', 'ingested'],
          body,
          raw: `## Lesson — [cursor] ${instr.heading}\n\n**Tags:** cursor, ingested\n\n${body}`,
          sourcePath: instr.source,
        });
      }
    } else {
      log.dim(TAG, 'No .cursorrules or .cursor/rules/*.mdc files found.');
    }
  }

  if (lessons.length === 0) {
    throw new TotemError(
      'NO_LESSONS',
      'No lessons found. Nothing to compile.',
      'Add lessons with `totem extract <pr>` or create .totem/lessons/*.md files manually.',
    );
  }

  log.info(TAG, `Found ${lessons.length} lessons`); // totem-ignore

  // ─── Telemetry-driven re-compile (mmnto/totem#1131, mmnto/totem#1235) ──
  // Both `--upgrade` (single hash) and `upgradeBatch` (array of hashes) narrow
  // `lessonsInScope` to only the target lessons, bypass the cache for those
  // targets, and thread per-lesson telemetry directives into Pipeline 2 prompts.
  // All other rules pass through unchanged.
  //
  // Internally both paths produce `upgradeTargets`: a Map from hash to the
  // optional telemetry prefix for that lesson. The compile loop uses this map
  // instead of the old `upgradeTargetHash` scalar so batch mode works without
  // duplicating the cache-bypass / outcome-tracking / stale-splice logic.
  //
  // `lessonsInScope` is what we validate and iterate for compilation. It starts
  // as the full lesson set (default behavior) and is narrowed to just the
  // target lesson(s) so that:
  //   1. An unrelated invalid lesson can't abort the upgrade (validateLessons)
  //   2. An unrelated cache-miss lesson doesn't leak into the compile batch
  //   3. `totem doctor --pr` branches stay scoped to the flagged rules only
  // The full `lessons` array is still used for `currentHashes` pruning so the
  // other compiled rules remain in newRules.

  // Validate that incompatible option combos are rejected up front.
  if (options.upgradeBatch) {
    if (options.upgrade) {
      throw new TotemConfigError(
        '--upgrade cannot be combined with upgradeBatch.',
        'Use one or the other, not both.',
        'CONFIG_INVALID',
      );
    }
    if (options.cloud) {
      throw new TotemError(
        'UPGRADE_CLOUD_UNSUPPORTED',
        'upgradeBatch is not supported with --cloud.',
        'Run upgradeBatch without --cloud. The cloud worker cannot thread per-lesson telemetry directives yet (mmnto/totem#1221).',
      );
    }
    if (options.force) {
      throw new TotemConfigError(
        'upgradeBatch cannot be combined with --force.',
        'The upgrade path already bypasses the cache for target rules only.',
        'CONFIG_INVALID',
      );
    }
  }

  // upgradeTargets: hash -> optional telemetry prefix. Set for both single and batch modes.
  let upgradeTargets: Map<string, string | undefined> | undefined;
  let lessonsInScope: typeof lessons = lessons;

  if (options.upgrade) {
    if (options.cloud) {
      throw new TotemError(
        'UPGRADE_CLOUD_UNSUPPORTED',
        '--upgrade is not supported with --cloud.',
        'Run `totem compile --upgrade <hash>` without --cloud. The cloud worker cannot thread a per-lesson telemetry directive yet (mmnto/totem#1221).',
      );
    }
    if (options.force) {
      // --force empties the cache before scoped eviction runs, silently turning
      // --upgrade into a full recompile. Reject the combo so intent is explicit.
      throw new TotemConfigError(
        '--upgrade cannot be combined with --force.',
        'Run `totem compile --upgrade <hash>` without --force. The upgrade path already bypasses the cache for the target rule only, preserving every other compiled rule.',
        'CONFIG_INVALID',
      );
    }

    const target = options.upgrade.toLowerCase();
    const matches = lessons.filter((l) => {
      const lessonHash = hashLesson(l.heading, l.body).toLowerCase();
      return lessonHash === target || lessonHash.startsWith(target);
    });

    if (matches.length === 0) {
      throw new TotemError(
        'UPGRADE_HASH_NOT_FOUND',
        `No lesson matches hash '${options.upgrade}'.`,
        'Run `totem doctor` to see flagged upgrade candidates, then re-run with the printed hash.',
      );
    }
    if (matches.length > 1) {
      const found = matches
        .map((m) => `${hashLesson(m.heading, m.body)} (${m.heading})`)
        .join(', ');
      throw new TotemError(
        'UPGRADE_HASH_AMBIGUOUS',
        `Hash prefix '${options.upgrade}' matches ${matches.length} lessons: ${found}`,
        'Use the full hash to disambiguate.',
      );
    }

    const upgradeTargetHash = hashLesson(matches[0]!.heading, matches[0]!.body);
    lessonsInScope = [matches[0]!];
    log.info(TAG, `--upgrade: targeting ${upgradeTargetHash} (${matches[0]!.heading})`);

    // Load existing telemetry to build the directive
    let telemetryPrefix: string | undefined;
    try {
      const { loadRuleMetrics } = await import('@mmnto/totem');
      const metricsFile = loadRuleMetrics(totemDir);
      const metric = metricsFile.rules[upgradeTargetHash];
      if (metric?.contextCounts) {
        telemetryPrefix = buildTelemetryPrefix(metric.contextCounts);
        log.dim(TAG, `--upgrade: telemetry directive prepared (${telemetryPrefix.length} chars)`);
      } else {
        log.warn(
          TAG,
          `--upgrade: no telemetry found for ${upgradeTargetHash}; recompiling without directive.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `--upgrade: failed to load telemetry — ${msg}`);
    }
    upgradeTargets = new Map([[upgradeTargetHash, telemetryPrefix]]);
  } else if (options.upgradeBatch) {
    upgradeTargets = new Map(
      options.upgradeBatch.map((e) => [e.hash.toLowerCase(), e.telemetryPrefix]), // totem-context: hash normalization, not a file path filter
    );
    // Narrow lessons to those matching the batch hashes. hashLesson output is
    // already lowercase hex so no extra normalization needed.
    lessonsInScope = lessons.filter((l) => upgradeTargets!.has(hashLesson(l.heading, l.body)));
    const matchedHashes = new Set(lessonsInScope.map((l) => hashLesson(l.heading, l.body)));
    const missingHashes = [...upgradeTargets.keys()].filter((hash) => !matchedHashes.has(hash));
    if (missingHashes.length > 0) {
      throw new TotemError(
        'UPGRADE_HASH_NOT_FOUND',
        `No lesson matches hash(es): ${missingHashes.join(', ')}.`,
        'Regenerate upgrade candidates or remove stale hashes from upgradeBatch.',
      );
    }
    log.info(TAG, `upgradeBatch: targeting ${lessonsInScope.length} lesson(s)`);
  }

  // ─── Pre-compilation gate: validate Pipeline 1 metadata ──
  // For --upgrade, scope validation to the target so unrelated invalid lessons
  // cannot block the upgrade (mmnto/totem#1234 CR finding).
  {
    const { validateLessons } = await import('@mmnto/totem');
    const lintResult = validateLessons(lessonsInScope);
    const errors = lintResult.diagnostics.filter((d) => d.severity === 'error');
    const warnings = lintResult.diagnostics.filter((d) => d.severity === 'warning');
    for (const d of warnings) {
      log.warn(TAG, `${d.lessonHeading}: [${d.field}] ${d.message}`);
    }
    if (errors.length > 0) {
      for (const d of errors) {
        log.error('Totem Error', `${d.lessonHeading}: [${d.field}] ${d.message}`);
      }
      throw new TotemError(
        'LINT_LESSONS_FAILED',
        `${errors.length} lesson(s) have invalid metadata. Fix them before compiling.`,
        'Run `totem lint-lessons` for details.',
      );
    }
  }

  // ─── Test fixture lookup (ADR-065) ──
  const testsDir = path.join(totemDir, 'tests');
  const testedHashes = getTestedHashes(testsDir, fs, path);

  const scaffoldDeps: AutoScaffoldDeps = {
    fs,
    path,
    testsDir,
    cwd,
    testedHashes,
    log,
    extractRuleExamples,
    deriveVirtualFilePath,
    scaffoldFixture,
    scaffoldFixturePath,
  };

  // Track the terminal outcome per upgrade target. For single --upgrade, the
  // map has one entry. For upgradeBatch, it has one entry per target. Default
  // 'noop' covers the case where a target was never enqueued.
  const upgradeOutcomes = new Map<string, UpgradeStatus>(
    upgradeTargets ? [...upgradeTargets.keys()].map((h) => [h, 'noop' as UpgradeStatus]) : [],
  );

  // ─── Phase 1: Regex compilation (requires orchestrator) ──
  if (config.orchestrator) {
    // Always load the existing file so lifecycle fields (status,
    // archivedReason, archivedAt) survive --force recompile (mmnto-ai/
    // totem#1587). The cache-skip logic below gates on !options.force so
    // every lesson still goes through the compile loop under --force;
    // buildCompiledRule then pulls the lifecycle fields from `existing`
    // onto the new rule via preserveLifecycleFields.
    const existingFile: CompiledRulesFile = loadCompiledRulesFile(rulesPath);
    const existingRules = existingFile.rules;
    const existingByHash = new Map(existingRules.map((r) => [r.lessonHash, r]));
    // mmnto/totem#1280 + mmnto-ai/totem#1481: in-memory nonCompilable is
    // `Map<hash, {title, reasonCode, reason?}>` so every write path carries
    // the full 4-tuple. The schema's Read transform normalizes legacy
    // strings and 2-tuples to the 4-tuple shape (reasonCode:
    // 'legacy-unknown') before we reach this block, so existingFile.
    // nonCompilable is always 4-tuple-shaped here.
    //
    // --force resets the nonCompilable ledger so previously-failed
    // lessons get re-attempted with whatever prompt improvements landed.
    // Failures that happen this pass re-populate the map.
    const nonCompilableMap = new Map<string, NonCompilableMapValue>(
      options.force
        ? []
        : (existingFile.nonCompilable ?? []).map((entry) => [
            entry.hash,
            { title: entry.title, reasonCode: entry.reasonCode, reason: entry.reason },
          ]),
    );

    // Note: we do NOT delete the --upgrade target from existingByHash here.
    // buildCompiledRule in @mmnto/totem looks up the old entry to preserve
    // metadata (createdAt, audit lineage). Deleting would make the upgraded
    // rule look brand-new and break garbage-collection heuristics. Instead,
    // we bypass the cache check for the target inside the loop below.

    const toCompile: LessonInput[] = [];

    // For --upgrade / upgradeBatch, iterate only the target lesson(s) so
    // unrelated cache-miss lessons don't leak into the compile batch
    // (mmnto/totem#1234 CR finding). Upgrade targets always bypass the cache --
    // the telemetry directive may unlock a pattern the compiler couldn't
    // produce on the first pass.
    for (const lesson of lessonsInScope) {
      const hash = hashLesson(lesson.heading, lesson.body);
      if (!upgradeTargets?.has(hash)) {
        // --force bypasses both caches: every lesson re-enters the
        // compile loop so pattern regenerates, while buildCompiledRule
        // pulls lifecycle fields forward from the existingByHash lookup
        // (mmnto-ai/totem#1587).
        if (!options.force && existingByHash.has(hash)) continue; // already compiled
        if (!options.force && nonCompilableMap.has(hash)) continue; // cached as non-compilable
      }
      toCompile.push({ index: lesson.index, heading: lesson.heading, body: lesson.body, hash });
    }

    if (toCompile.length === 0) {
      // mmnto/totem#1281: even with no lessons to compile, stale entries left
      // over from a previous run still need to be drained. Two cases share
      // this no-op stall:
      //  1. Stale `nonCompilable` entries from lessons that were edited or
      //     removed (the original ticket scope).
      //  2. Stale compiled rules whose source lesson has been removed
      //     entirely — pointed out by GCA on PR #1331 review. Same
      //     inconsistency vs. the active-compile branch, same fix.
      // Without this, stale entries survive forever until some future compile
      // run happens to have real work to do. Both counts flow into the
      // success log so the reported state matches disk state.
      let reportedNonCompilable = nonCompilableMap.size;
      let reportedCompiled = existingRules.length;
      if (!options.raw) {
        const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
        const { fresh: freshRules, pruned: rulesPruned } = pruneStaleRules(
          existingRules,
          currentHashes,
        );
        const { fresh: freshNonCompilable, drained } = pruneStaleNonCompilable(
          nonCompilableMap,
          currentHashes,
        );

        // mmnto/totem#1337: detect "pure input-hash drift" — the case where
        // a lesson file was added or removed but produced no rule/nonCompilable
        // churn (e.g. a user deleted a lesson whose rule was already manually
        // removed, or added a lesson that never got compiled). Both rulesPruned
        // and drained will be zero, so the pre-1.14.3 refresh guard would skip
        // the manifest write, leaving verify-manifest to fail on the next
        // git push. Fix: refresh the manifest on drift even when the rules
        // file is untouched.
        //
        // Carefully partition the writes:
        //   - compiled-rules.json is rewritten ONLY when something was pruned
        //   - compile-manifest.json is rewritten when EITHER something was
        //     pruned OR the input_hash drifted
        // Rewriting the rules file on pure drift would be a spurious touch
        // that invalidates mtime-based caches downstream.
        const lessonsDir = path.join(totemDir, 'lessons');
        const manifestPath = path.join(totemDir, 'compile-manifest.json');
        ensureLessonsDir(lessonsDir);
        const currentInputHash = generateInputHash(lessonsDir);
        let existingManifestInputHash: string | null = null;
        try {
          existingManifestInputHash = readCompileManifest(manifestPath).input_hash;
        } catch (err) {
          // ONLY swallow "manifest does not exist" (ENOENT) — everything else
          // bubbles up so the user sees a loud failure rather than silently
          // having their file overwritten (Tenet 4: Fail Loud, Never Drift).
          //
          // readCompileManifest wraps ENOENT from readJsonSafe into a
          // TotemParseError with code 'PARSE_FAILED', preserving the original
          // NodeJS.ErrnoException in `.cause`. Checking the cause chain
          // (rather than err.code or a message-substring match) correctly
          // distinguishes missing-file from:
          //   - corrupted JSON (cause is a SyntaxError with no `.code`)
          //   - schema mismatch (cause is a ZodError with no `.code`)
          //   - permission errors (cause is ErrnoException with code='EACCES'
          //     or 'EPERM', which are NOT 'ENOENT')
          //
          // The message-substring approach GCA proposed on PR review would
          // couple us to error string wording that could drift in future
          // refactors; walking the cause chain is the structurally correct
          // check. Bounded depth prevents pathological infinite cycles.
          let causeWalker: unknown = err;
          let isMissingFile = false;
          for (let depth = 0; depth < 8 && causeWalker instanceof Error; depth++) {
            if ((causeWalker as NodeJS.ErrnoException).code === 'ENOENT') {
              isMissingFile = true;
              break;
            }
            causeWalker = (causeWalker as Error & { cause?: unknown }).cause;
          }
          if (!isMissingFile) throw err;
        }
        const manifestStale = existingManifestInputHash !== currentInputHash;

        if (rulesPruned > 0 || drained > 0) {
          saveCompiledRulesFile(rulesPath, {
            version: 1,
            rules: freshRules,
            nonCompilable: freshNonCompilable,
          });
          if (rulesPruned > 0) {
            log.dim(
              TAG,
              `Pruned ${rulesPruned} stale rule${rulesPruned === 1 ? '' : 's'} (lessons removed)`,
            ); // totem-context: log only fires when actual draining happens
          }
          if (drained > 0) {
            log.dim(
              TAG,
              `Pruned ${drained} stale non-compilable entr${drained === 1 ? 'y' : 'ies'} (lessons edited or removed)`,
            ); // totem-context: log only fires when actual draining happens
          }
        }

        if (rulesPruned > 0 || drained > 0 || manifestStale) {
          // CR finding on PR mmnto/totem#1331: keep the compile manifest in sync
          // with the rewritten on-disk state. Post-mmnto/totem#1337, this block
          // also fires on pure input-hash drift — rewriting only the manifest,
          // leaving the rules file untouched.
          const outputHash = generateOutputHash(rulesPath);
          writeCompileManifest(manifestPath, {
            compiled_at: new Date().toISOString(),
            model: options.model ?? config.orchestrator?.defaultModel ?? 'unknown',
            input_hash: currentInputHash,
            output_hash: outputHash,
            rule_count: freshRules.length,
          });
          log.dim(TAG, `Manifest: ${currentInputHash.slice(0, 8)}…→${outputHash.slice(0, 8)}…`); // totem-context: provenance trace matches active-compile branch
          reportedNonCompilable = freshNonCompilable.length;
          reportedCompiled = freshRules.length;
        }
      }
      log.success(
        TAG,
        `All ${lessonsInScope.length} lesson(s) in scope already processed (${reportedCompiled} compiled, ${reportedNonCompilable} non-compilable). Use --force to recompile.`,
      ); // totem-context: success log reports post-prune counts
    } else {
      const { createSpinner } = await import('../ui.js');
      const spinner = await createSpinner(TAG, 'Compiling...');

      let compiled = 0;
      let skipped = 0;
      let failed = 0;
      const skippedLessons: { heading: string; reason?: string }[] = [];
      // Always initialize newRules from existingRules so transient compile
      // failures (network/rate-limit/manual reject/example-verification/
      // cloud parse) under --force do NOT silently drop rules. Each push
      // site uses upsertRule below to replace-by-lessonHash on successful
      // compile, so the old rule survives when a new rule fails to
      // produce (CR finding on PR mmnto-ai/totem#1629). Dangling-archive guard still
      // runs via the currentHashes filter below.
      const newRules: CompiledRule[] = [...existingRules];

      const currentHashes = new Set(lessons.map((l) => hashLesson(l.heading, l.body)));
      const freshRules = newRules.filter((r) => currentHashes.has(r.lessonHash));
      const pruned = newRules.length - freshRules.length;
      if (pruned > 0) {
        log.dim(TAG, `Pruned ${pruned} stale rules (lessons edited or removed)`); // totem-ignore
      }
      newRules.length = 0;
      newRules.push(...freshRules);

      // --upgrade: the stale copy is NOT pre-filtered here. If we removed it now
      // and compilation failed (network error, LLM refusal, parser failure), the
      // rule would be silently deleted from compiled-rules.json. Instead, we
      // splice the stale copy inside the `case 'compiled':` handler below, so
      // the fresh rule only replaces the old one on a successful re-compile.

      const coreDeps = {
        parseCompilerResponse,
        // mmnto/totem#1291 Phase 3: thread the optional systemPrompt from
        // compileLesson through to runOrchestrator so the static compiler
        // template gets cached server-side by Anthropic instead of being
        // re-billed at full input-token cost on every lesson.
        runOrchestrator: (prompt: string, systemPrompt?: string) =>
          runOrchestrator({
            prompt,
            systemPrompt,
            tag: TAG,
            options,
            config,
            cwd,
            temperature: 0,
          }),
        existingByHash,
        pipeline3Prompt: PIPELINE3_COMPILER_PROMPT,
        callbacks: {
          onWarn: (heading: string, msg: string) => log.warn(TAG, `[${heading}] ${msg}`),
          onDim: (heading: string, msg: string) => log.dim(TAG, `[${heading}] ${msg}`),
        },
      };

      // ─── Cloud compilation (Proposal 188 Phase 2) ───
      if (options.cloud) {
        const cloudUrl = options.cloud;

        // Compile manual patterns locally first (zero LLM, instant)
        const cloudLessons: LessonInput[] = [];
        for (const lesson of toCompile) {
          const manualResult = buildManualRule(lesson, existingByHash);
          if (manualResult.rule) {
            // Verify rule against inline Example Hit/Miss lines
            const testResult = verifyRuleExamples(manualResult.rule, lesson.body);
            if (testResult && !testResult.passed) {
              log.warn(TAG, `[${lesson.heading}] ${formatExampleFailure(testResult)}`);
              failed++;
              continue;
            }
            // ADR-065: Pipeline 1 error rules require a test fixture
            if (manualResult.rule.severity === 'error' && !testedHashes.has(lesson.hash)) {
              if (options.raw || !autoScaffoldFixture(lesson, manualResult.rule, scaffoldDeps)) {
                manualResult.rule.severity = 'warning';
                log.warn(
                  TAG,
                  `[${lesson.heading}] Downgraded to warning — no test fixture (ADR-065)`,
                );
              }
            }
            upsertRule(newRules, manualResult.rule);
            compiled++;
            logCompiledRule(log, lesson, manualResult.rule);
          } else if (manualResult.rejectReason) {
            log.warn(TAG, `[${lesson.heading}] ${manualResult.rejectReason}`);
            failed++;
          } else {
            cloudLessons.push(lesson);
          }
        }

        // Skip cloud call if all lessons were manual
        if (cloudLessons.length === 0) {
          spinner.succeed(
            `${newRules.length} rules — ${compiled} compiled${failed > 0 ? `, ${failed} failed` : ''} (all manual, no cloud call needed)`,
          );
        } else {
          log.info(TAG, `Cloud compile: ${cloudLessons.length} lessons → ${cloudUrl}`);

          // Resolve auth token for Cloud Run (uses gcloud identity token or TOTEM_CLOUD_TOKEN env)
          const cloudToken =
            process.env['TOTEM_CLOUD_TOKEN'] ??
            (await (async () => {
              try {
                const { safeExec } = await import('@mmnto/totem');
                return safeExec('gcloud', ['auth', 'print-identity-token']);
              } catch {
                return undefined;
              }
            })());

          // DLP: scrub secrets from lesson content before sending off-machine
          const { maskSecrets } = await import('@mmnto/totem');
          const scrubbedLessons = cloudLessons.map((l) => ({
            heading: maskSecrets(l.heading),
            body: maskSecrets(l.body),
            hash: l.hash,
          }));

          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (cloudToken) headers['Authorization'] = `Bearer ${cloudToken}`;

          const response = await fetch(`${cloudUrl}/compile`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              lessons: scrubbedLessons,
              prompt: COMPILER_SYSTEM_PROMPT,
              model: options.model ?? config.orchestrator?.defaultModel ?? 'gemini-3-flash-preview',
              concurrency: CLOUD_CONCURRENCY,
            }),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new TotemError(
              'COMPILE_FAILED',
              `Cloud compile failed: ${text}`,
              'Check the cloud endpoint.',
            );
          }

          const data = (await response.json()) as {
            results: { hash: string; response: string | null; err?: string }[];
            stats: { elapsed_seconds: number; succeeded: number; failed: number };
          };

          log.info(
            TAG,
            `Cloud: ${data.stats.succeeded} succeeded, ${data.stats.failed} failed in ${data.stats.elapsed_seconds}s`,
          );

          for (const cloudResult of data.results) {
            if (!cloudResult.response) {
              failed++;
              continue;
            }

            const lesson = toCompile.find((l) => l.hash === cloudResult.hash);
            if (!lesson) continue;

            const parsed = parseCompilerResponse(cloudResult.response!);
            if (!parsed) {
              failed++;
              continue;
            }
            if (!parsed.compilable) {
              // mmnto/totem#1280: capture title alongside hash for observability.
              // mmnto-ai/totem#1481: the cloud worker currently classifies every
              // compilable:false outcome as out-of-scope. Granular cloud-side
              // reasonCodes are out of scope here and track via mmnto/totem#1221.
              nonCompilableMap.set(lesson.hash, {
                title: lesson.heading,
                reasonCode: 'out-of-scope',
                reason: parsed.reason,
              });
              skippedLessons.push({ heading: lesson.heading, reason: parsed.reason });
              skipped++;
              continue;
            }

            const ruleResult = buildCompiledRule(parsed, lesson, existingByHash);
            if (ruleResult.rule) {
              // Verify rule against inline Example Hit/Miss lines
              const testResult = verifyRuleExamples(ruleResult.rule, lesson.body);
              if (testResult && !testResult.passed) {
                log.warn(TAG, `[${lesson.heading}] ${formatExampleFailure(testResult)}`);
                failed++;
                continue;
              }
              upsertRule(newRules, ruleResult.rule);
              compiled++;
              logCompiledRule(log, lesson, ruleResult.rule);
            } else {
              if (ruleResult.rejectReason) {
                log.warn(TAG, `[${lesson.heading}] ${ruleResult.rejectReason} — skipping`);
              }
              failed++;
            }
          }

          spinner.succeed(
            `${newRules.length} rules — ${compiled} compiled, ${skipped} skipped, ${failed} failed (cloud: ${data.stats.elapsed_seconds}s)`,
          );
        } // end cloudLessons.length > 0
      } else {
        // Compile lessons in parallel batches (Proposal 188 Phase 1)
        const { ProgressTracker } = await import('../progress.js');
        const { withRetry } = await import('../retry.js');
        const tracker = new ProgressTracker(toCompile.length);
        spinner.update(tracker.format());

        const parsed = Number(options.concurrency ?? DEFAULT_CONCURRENCY);
        const CONCURRENCY = Math.min(
          MAX_CONCURRENCY,
          Math.max(1, Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : parsed),
        );
        for (let i = 0; i < toCompile.length; i += CONCURRENCY) {
          const batch = toCompile.slice(i, i + CONCURRENCY);
          const results = await Promise.all(
            batch.map((lesson) => {
              // Per-lesson deps: telemetry prefix only applies to upgrade targets.
              // For upgradeBatch, each target may carry a distinct prefix.
              const lessonDeps = upgradeTargets?.has(lesson.hash)
                ? { ...coreDeps, telemetryPrefix: upgradeTargets.get(lesson.hash) }
                : coreDeps;
              return withRetry(
                () => compileLessonCore(lesson, COMPILER_SYSTEM_PROMPT, lessonDeps),
                {
                  onRetry: (attempt, delayMs) => {
                    log.warn(
                      TAG,
                      `[${lesson.heading}] Rate limited — retry ${attempt} in ${delayMs}ms`,
                    );
                  },
                },
              )
                .then((result) => {
                  tracker.tick();
                  spinner.update(tracker.format());
                  return { lesson, result };
                })
                .catch((err) => {
                  tracker.tick();
                  spinner.update(tracker.format());
                  const message = err instanceof Error ? err.message : String(err);
                  log.warn(TAG, `[${lesson.heading}] ${message} — skipping`);
                  return { lesson, result: { status: 'failed' as const } };
                });
            }),
          );

          for (const { lesson, result } of results) {
            // mmnto-ai/totem#1482: emit the per-lesson layer-trace block when
            // --verbose is active. The whole block ships via one stdout.write
            // call so concurrent lessons cannot interleave their output.
            // Non-trace verbose behavior (skipped-lesson reasons) still fires
            // further down; this renders the structured trace alongside.
            if (options.verbose) {
              const resultTrace =
                'trace' in result ? (result.trace as LayerTraceEvent[] | undefined) : undefined;
              const reasonCode = result.status === 'skipped' ? result.reasonCode : undefined;
              const block = formatVerboseTraceBlock(lesson, result.status, reasonCode, resultTrace);
              process.stdout.write(block + '\n');
            }

            // Upgrade and --force: remove the stale copy from newRules for
            // any terminal outcome where the rule's state CHANGES (compiled
            // -> new pattern replaces old via upsertRule below; skipped ->
            // rule moves to nonCompilable and must no longer appear as an
            // active rule). For `failed` (transient error) and `noop` (no
            // change), leave the old rule intact so a flaky network /
            // rate-limit doesn't silently delete work (mmnto/totem#1234
            // GCA finding; mmnto-ai/totem#1587 extension to cover --force).
            //
            // The `compiled` case is redundant with upsertRule's replace-
            // by-hash semantics, but the splice still matters for `skipped`
            // where no rule is pushed back.
            if (
              (upgradeTargets?.has(lesson.hash) || options.force) &&
              (result.status === 'compiled' || result.status === 'skipped')
            ) {
              const staleIdx = newRules.findIndex((r) => r.lessonHash === lesson.hash);
              if (staleIdx >= 0) newRules.splice(staleIdx, 1);
            }

            // Record the terminal outcome for each upgrade target. Used by
            // `totem doctor --pr` to distinguish real replacements from
            // noop/skipped/failed so its PR body doesn't lie about work done
            // (mmnto/totem#1234 CR finding).
            if (upgradeTargets?.has(lesson.hash)) {
              switch (result.status) {
                case 'compiled':
                  upgradeOutcomes.set(lesson.hash, 'replaced');
                  break;
                case 'skipped':
                  upgradeOutcomes.set(lesson.hash, 'skipped');
                  break;
                case 'failed':
                  upgradeOutcomes.set(lesson.hash, 'failed');
                  break;
                case 'noop':
                  upgradeOutcomes.set(lesson.hash, 'noop');
                  break;
              }
            }

            switch (result.status) {
              case 'compiled':
                // ADR-065: Pipeline 1 error rules require a test fixture
                if (
                  extractManualPattern(lesson.body) &&
                  result.rule.severity === 'error' &&
                  !testedHashes.has(lesson.hash)
                ) {
                  if (options.raw || !autoScaffoldFixture(lesson, result.rule, scaffoldDeps)) {
                    result.rule.severity = 'warning';
                    log.warn(
                      TAG,
                      `[${lesson.heading}] Downgraded to warning — no test fixture (ADR-065)`,
                    );
                  }
                }
                // Upgrade targets: also clear any stale nonCompilable entry so
                // the successfully-compiled rule doesn't coexist with a
                // non-compilable marker for the same hash.
                if (upgradeTargets?.has(lesson.hash)) {
                  nonCompilableMap.delete(lesson.hash);
                }
                upsertRule(newRules, result.rule);
                compiled++;
                logCompiledRule(log, lesson, result.rule);
                break;
              case 'skipped':
                // mmnto/totem#1280 + mmnto-ai/totem#1481: capture the full
                // 4-tuple so ledger reads downstream (doctor, telemetry) see
                // a specific reasonCode rather than normalizing to
                // 'legacy-unknown'.
                nonCompilableMap.set(result.hash, {
                  title: lesson.heading,
                  reasonCode: result.reasonCode,
                  reason: result.reason,
                });
                skippedLessons.push({ heading: lesson.heading, reason: result.reason });
                skipped++;
                break;
              case 'failed':
                failed++;
                break;
              case 'noop':
                break;
            }
          }
        }
      } // end cloud/local else

      if (!options.raw) {
        // mmnto/totem#1280: Prune stale non-compilable entries (lesson was edited or removed)
        // and write the result as {hash, title} tuples for observability.
        // The helper also covers the no-op path via mmnto/totem#1281.
        const { fresh: freshNonCompilable, drained: nonCompilableDrained } =
          pruneStaleNonCompilable(nonCompilableMap, currentHashes);
        if (nonCompilableDrained > 0) {
          // GCA finding on PR #1331: log drained entries here for parity with
          // the no-op branch, so telemetry traces are symmetric.
          log.dim(
            TAG,
            `Pruned ${nonCompilableDrained} stale non-compilable entr${nonCompilableDrained === 1 ? 'y' : 'ies'} (lessons edited or removed)`,
          ); // totem-context: log only fires when actual draining happens
        }
        saveCompiledRulesFile(rulesPath, {
          version: 1,
          rules: newRules,
          nonCompilable: freshNonCompilable,
        });

        // ─── Write compile manifest (provenance chain) ───
        // CR finding on PR mmnto/totem#1348: generateInputHash/generateOutputHash/
        // writeCompileManifest are already destructured at the top of this
        // handler via the mmnto/totem#1337 import consolidation — no dynamic
        // re-import needed here.
        const lessonsDir = path.join(totemDir, 'lessons');
        const manifestPath = path.join(totemDir, 'compile-manifest.json');
        ensureLessonsDir(lessonsDir);
        const inputHash = generateInputHash(lessonsDir);
        const outputHash = generateOutputHash(rulesPath);
        writeCompileManifest(manifestPath, {
          compiled_at: new Date().toISOString(),
          model: options.model ?? config.orchestrator?.defaultModel ?? 'unknown',
          input_hash: inputHash,
          output_hash: outputHash,
          rule_count: newRules.length,
        });
        log.dim(TAG, `Manifest: ${inputHash.slice(0, 8)}…→${outputHash.slice(0, 8)}…`);

        spinner.succeed(
          `${newRules.length} rules — ${compiled} compiled, ${skipped} skipped, ${failed} failed`,
        );

        // ─── Skipped lesson transparency (#1060) ───
        if (skippedLessons.length > 0) {
          log.warn(TAG, `${skippedLessons.length} lesson(s) could not be compiled into rules.`);
          if (options.verbose) {
            for (const sl of skippedLessons) {
              const detail = sl.reason ?? 'no reason provided';
              log.dim(TAG, `  ↳ ${sl.heading}: ${detail}`);
            }
          } else {
            log.dim(TAG, 'Run totem compile --verbose to see why.');
          }
        }
      }
    }
  } else if (!options.export) {
    throw new TotemConfigError(
      'No orchestrator configured. Regex compilation requires a Full-tier config.',
      'Use --export to export lessons to AI config files without an orchestrator.',
      'CONFIG_MISSING',
    );
  }

  // ─── Phase 2: Export to AI config files (deterministic, no LLM) ──
  if (options.export) {
    if (!config.exports || Object.keys(config.exports).length === 0) {
      log.warn(TAG, 'No export targets configured in totem.config.ts. Add an `exports` field.');
      return;
    }

    // Filter lessons whose compiled rule is archived so exports never emit
    // guidance the project has explicitly silenced. Mirrors the mmnto-ai/totem#1345
    // lint-path filter in loadCompiledRules; closes the symmetric export-path hole.
    const rawRulesFile = loadCompiledRulesFile(rulesPath);
    const archivedHashes = new Set(
      rawRulesFile.rules
        .filter((r) => r.status === 'archived')
        .map((r) => r.lessonHash.toLowerCase()),
    );
    const lessonsForExport =
      archivedHashes.size === 0
        ? lessons
        : lessons.filter((l) => !archivedHashes.has(hashLesson(l.heading, l.body).toLowerCase()));

    for (const [name, filePath] of Object.entries(config.exports)) {
      const absPath = path.join(cwd, filePath);
      exportLessons(lessonsForExport, absPath);
      log.success(TAG, `Exported ${lessonsForExport.length} rules to ${filePath} (${name})`); // totem-ignore
    }
  }

  // Return outcomes so callers can report precisely. Only set when --upgrade
  // or upgradeBatch was requested; default compile runs return void.
  if (upgradeTargets) {
    if (options.upgradeBatch) {
      // Batch mode: return an array of outcomes, one per requested hash.
      return options.upgradeBatch.map((entry) => ({
        hash: entry.hash.toLowerCase(),
        status: upgradeOutcomes.get(entry.hash.toLowerCase()) ?? 'noop',
      }));
    }
    // Single --upgrade: return scalar outcome for backwards compatibility.
    const [hash, status] = [...upgradeOutcomes.entries()][0]!;
    return { hash, status };
  }
}
