/**
 * ADR-091 Stage 4 Verify-Against-Codebase verifier (mmnto-ai/totem#1682).
 *
 * Runs a compiled rule deterministically (zero LLM) against the consumer's
 * existing codebase before promoting it to Active status. Catches the class
 * of false positive that Layer 3 (ADR-088) cannot — Layer 3 verifies the
 * pattern matches the lesson's authored `badExample` (internal consistency);
 * Stage 4 verifies the pattern doesn't accidentally fire on legitimate code
 * (global false-positive safety).
 *
 * Four outcomes per ADR-091 §"Stage 4: Verify-Against-Codebase":
 *
 *   - **No matches** (`outcome: 'no-matches'`) — the verifier ran, found zero
 *     hits in the codebase. Caller sets `status: 'untested-against-codebase'`;
 *     subsequent compile cycles in a populated repo can re-run Stage 4 and
 *     promote.
 *   - **Out-of-scope baseline match** (`outcome: 'out-of-scope'`) — the rule
 *     fired on at least one file in the verification baseline (test files,
 *     fixture directories, or files outside the rule's `fileGlobs` scope).
 *     The pattern is over-broad. Caller archives the rule with
 *     `reasonCode: 'stage4-out-of-scope-match'` and the offending paths.
 *   - **In-scope `badExample`-shape match** (`outcome: 'in-scope-bad-example'`)
 *     — the rule fired only on in-scope files AND every in-scope match line is
 *     structurally equivalent to the rule's `badExample`. The rule fires on
 *     real code in the exact authored shape. Caller sets `status: 'active'`
 *     with `confidence: 'high'`.
 *   - **Candidate Debt** (`outcome: 'candidate-debt'`) — the rule fired only
 *     on in-scope files but at least one match line differs from the
 *     `badExample` shape. The rule may be catching real debt, or producing
 *     false positives the LLM-generated pattern overshoots into. Caller
 *     accepts as `status: 'active'` and forces `severity: 'warning'` so it
 *     never breaks CI on first run; `totem doctor` (mmnto-ai/totem#1685)
 *     surfaces the candidate-debt sites for human confirmation.
 *
 * Bootstrap modes: T1 ships local-compile fully (the verifier runs against
 * the consumer's working tree before `totem lesson compile` serializes the
 * rule). Pack install→lint promotion lands in T3 (mmnto-ai/totem#1684).
 * Consumer baseline overrides land in T2 (mmnto-ai/totem#1683). Perf
 * optimizations (single-pass, file-tree caching, streaming short-circuit)
 * land in T5 (mmnto-ai/totem#1686). T1 walks per-rule, no caching.
 *
 * Architecture: callback-based filesystem. The verifier accepts `listFiles`
 * + `readFile` callbacks instead of touching `fs` directly so core stays
 * orchestration-only. CLI implementations back the callbacks with `git
 * ls-files` and `fs.readFile`; tests stub them with synthetic file maps.
 */

import type { CompiledRule, DiffAddition, Violation } from './compiler-schema.js';
import type { CoreLogger, RuleEngineContext } from './rule-engine.js';
import {
  applyAstRulesToAdditions,
  applyRulesToAdditions,
  fileMatchesGlobs,
} from './rule-engine.js';

// ─── Types ──────────────────────────────────────────

export interface Stage4Baseline {
  /**
   * Glob patterns the rule MUST NOT fire on. Files matching any of these
   * globs are part of the verification baseline — a match on one of them
   * is evidence the pattern is over-broad. T1 shipped with `DEFAULT_BASELINE_GLOBS`
   * (test + fixture patterns); T2 (mmnto-ai/totem#1683) layers consumer
   * `extend` / `exclude` overrides via `review.stage4Baseline` config.
   *
   * Files outside the rule's `fileGlobs` scope are implicitly in the baseline
   * — no need to list them here. The verifier computes the implicit case
   * from `rule.fileGlobs` at evaluation time.
   */
  readonly excludeFileGlobs: readonly string[];

  /**
   * Provenance: globs added via `# stage4-baseline:` directives in the
   * consumer's `.totemignore` file. Empty when no such directives. Read
   * by `totem doctor` (T4) and trace events; the verifier itself only
   * reads `excludeFileGlobs`.
   */
  readonly extendedFromIgnoreFile: readonly string[];

  /**
   * Provenance: globs added via `review.stage4Baseline.extend` in
   * `totem.config.ts`. Empty when not configured.
   */
  readonly extendedFromConfig: readonly string[];

  /**
   * Provenance: globs removed from the default baseline via
   * `review.stage4Baseline.exclude` in `totem.config.ts`. Empty when not
   * configured. Useful for diagnosing why a rule fires on a path the
   * consumer expected to be in the baseline.
   */
  readonly excludedFromConfig: readonly string[];
}

export type Stage4Outcome =
  | 'no-matches'
  | 'out-of-scope'
  | 'in-scope-bad-example'
  | 'candidate-debt';

export interface Stage4VerificationResult {
  outcome: Stage4Outcome;
  /** Repo-relative paths where the rule fired AND the file is in the baseline. */
  readonly baselineMatches: readonly string[];
  /** Repo-relative paths where the rule fired AND the file is in scope. */
  readonly inScopeMatches: readonly string[];
  /**
   * Match lines from in-scope hits that did NOT match the `badExample`
   * shape (after trimming). Empty when `outcome === 'in-scope-bad-example'`.
   * Populated when `outcome === 'candidate-debt'` to feed the `totem doctor`
   * UX surface in T4 (mmnto-ai/totem#1685).
   */
  readonly candidateDebtLines: readonly string[];
}

export interface Stage4VerifierDeps {
  /**
   * Returns repo-relative paths of all files to verify against. CLI
   * implementation calls `git ls-files --recurse-submodules`. Tests pass
   * a synthetic list. Empty array is valid input — the verifier returns
   * `outcome: 'no-matches'` (the zero-files case is indistinguishable from
   * the no-hits case at the API level; both produce `untested-against-codebase`
   * status downstream).
   */
  listFiles: () => Promise<readonly string[]>;
  /**
   * Returns the file content as a string. CLI implementation reads from
   * the working tree (`fs.readFile`). MUST throw if the file is missing —
   * Stage 4 is a fail-loud contract per Tenet 4.
   */
  readFile: (file: string) => Promise<string>;
  /**
   * Optional working directory absolute path. Required when the verifier
   * encounters ast / ast-grep rules — `applyAstRulesToAdditions` resolves
   * file content against this root. Regex-only verification does not need
   * it. T1 callers always pass the repo root.
   */
  workingDirectory?: string;
  /** Optional rule-engine context. Defaults to a no-op logger. */
  ruleCtx?: RuleEngineContext;
}

// ─── Default baseline ───────────────────────────────

/**
 * Glob shapes the test-contract scope classifier (mmnto-ai/totem#1626 /
 * mmnto-ai/totem#1652) promotes-to-test-inclusive when emitting LLM scope.
 * Stage 4 mirrors them as the default baseline so any rule that fires on a
 * test or fixture file is treated as out-of-scope by default. T2
 * (mmnto-ai/totem#1683) lets consumers `exclude` from this list when their
 * project legitimately treats `tests/` as production.
 */
export const DEFAULT_BASELINE_GLOBS: readonly string[] = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/tests/**',
  '**/__fixtures__/**',
  '**/fixtures/**',
];

/**
 * Backwards-compatible shorthand for `resolveStage4Baseline({})`. Returns the
 * default baseline (test + fixture globs) with empty provenance arrays. Kept
 * because pre-T2 callers (early CLI integration sites, tests) pass no
 * overrides; new callers should prefer `resolveStage4Baseline` directly so
 * config + .totemignore overrides flow through.
 */
export function getDefaultBaseline(): Stage4Baseline {
  return resolveStage4Baseline({});
}

// ─── Manifest exclusions (mmnto-ai/totem#1765) ──────

export const STAGE4_MANIFEST_EXCLUSIONS: readonly string[] = ['.totem/compiled-rules.json'];

// ─── Baseline resolver (mmnto-ai/totem#1683) ────────

export interface ResolveStage4BaselineInput {
  /** Globs parsed from `# stage4-baseline:` directives in `.totemignore`. */
  readonly ignoreDirectives?: readonly string[];
  /** Globs from `review.stage4Baseline.extend` in `totem.config.ts`. */
  readonly configExtend?: readonly string[];
  /** Globs from `review.stage4Baseline.exclude` in `totem.config.ts`. */
  readonly configExclude?: readonly string[];
}

/**
 * Compute the effective Stage 4 baseline for a compile run.
 *
 * Composition: `defaults ∪ ignoreDirectives ∪ configExtend ∖ configExclude`.
 * `configExclude` is set-difference (LAST), so a consumer can remove a
 * default baseline glob like `**\/tests/**` when their project legitimately
 * treats `tests/` as production. Set membership uses byte-equal comparison
 * on the glob string, NOT path matching — `exclude: ['**\/tests/**']`
 * removes that exact default entry, not every glob that happens to match
 * a `tests/` path.
 *
 * Pure function. Does NOT read the filesystem; the CLI integration site
 * reads `.totemignore` and parses it via `parseStage4BaselineDirectives`
 * before passing the directives in.
 *
 * @param input - The three composition inputs (all optional / default to `[]`).
 * @returns A `Stage4Baseline` whose `excludeFileGlobs` is consumed by the
 *   verifier and whose three provenance arrays are read by `totem doctor`
 *   (T4 / `mmnto-ai/totem#1685`) and trace events.
 */
export function resolveStage4Baseline(input: ResolveStage4BaselineInput): Stage4Baseline {
  const ignoreDirectives = input.ignoreDirectives ?? [];
  const configExtend = input.configExtend ?? [];
  const configExclude = input.configExclude ?? [];

  const excludeSet = new Set<string>(DEFAULT_BASELINE_GLOBS);
  for (const g of ignoreDirectives) excludeSet.add(g);
  for (const g of configExtend) excludeSet.add(g);
  for (const g of configExclude) excludeSet.delete(g);

  return {
    excludeFileGlobs: [...excludeSet],
    extendedFromIgnoreFile: [...ignoreDirectives],
    extendedFromConfig: [...configExtend],
    excludedFromConfig: [...configExclude],
  };
}

// ─── .totemignore directive parser (mmnto-ai/totem#1683) ─

const STAGE4_BASELINE_DIRECTIVE_RE = /^#\s*stage4-baseline:\s*(.+?)\s*$/;

/**
 * Extract `# stage4-baseline: <glob>` directives from `.totemignore` content
 * (or any line-oriented text). The leading `#` is REQUIRED — the directive
 * lives on a comment line so it doesn't interfere with the rest of
 * `.totemignore`'s ignore semantics. Variable whitespace around the `#`,
 * the colon, and the body is allowed; the regex collapses it.
 *
 * Returns the globs in source order. Empty / whitespace-only directive
 * bodies are skipped silently (no throw). The directive name is
 * case-sensitive to match `.totemignore`'s overall convention.
 *
 * Pure function (`string → string[]`) so it can be invoked from any core
 * consumer. CLI reads the file and hands the content to this helper;
 * MCP integrations may want the same surface in the future.
 *
 * @param content - Raw `.totemignore` text (or any line-oriented content).
 *   Empty or undefined returns `[]`. CRLF and LF line endings both work.
 * @returns Glob strings extracted from `# stage4-baseline:` lines, in
 *   source order, excluding empty/whitespace-only directive bodies.
 *
 * @example
 * ```ts
 * parseStage4BaselineDirectives('# stage4-baseline: build/**\nsrc/temp/**');
 * // → ['build/**']  (only the directive line; 'src/temp/**' is ordinary
 * //                 .totemignore content, not a stage4 directive)
 * ```
 */
export function parseStage4BaselineDirectives(content: string): string[] {
  if (!content) return [];
  const out: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const match = STAGE4_BASELINE_DIRECTIVE_RE.exec(rawLine);
    if (!match) continue;
    const body = match[1]?.trim() ?? '';
    if (body.length === 0) continue;
    out.push(body);
  }
  return out;
}

/**
 * A file is "in scope" for Stage 4 verification when it matches the rule's
 * declared `fileGlobs` (or has none, meaning the rule applies everywhere)
 * AND is not in the baseline-excluded set. A baseline-excluded test file
 * inside `**\/*.ts` scope counts as baseline, not in-scope, because the
 * verifier's job is to detect over-broad firing — including on tests the
 * rule is supposed to skip.
 *
 * Glob matching delegates to `fileMatchesGlobs` from `rule-engine.ts`
 * (mmnto-ai/totem#1758) — single source of truth for glob semantics
 * across rule classification and Stage 4 baseline classification. The
 * earlier local regex-conversion matcher had a substring hole
 * (`**\/tests/**` would match `src/contests/foo.ts`) which the
 * pattern-specific matcher in rule-engine fixes by construction.
 */
function classifyFile(
  filePath: string,
  ruleFileGlobs: readonly string[] | undefined,
  baseline: Stage4Baseline,
): 'in-scope' | 'baseline' {
  // Rule has explicit fileGlobs and this file doesn't match → baseline (out-of-scope).
  if (ruleFileGlobs && ruleFileGlobs.length > 0) {
    if (!fileMatchesGlobs(filePath, ruleFileGlobs)) return 'baseline';
  }
  // File matches rule scope (or rule has no scope). Now check baseline overrides.
  //
  // Guard against empty positive set explicitly. `fileMatchesGlobs` has
  // default-allow semantics when its positive-glob set is empty (returns
  // `true` so a rule with empty fileGlobs runs everywhere — that's the
  // rule-engine's contract). Stage 4's baseline doesn't share that
  // contract: an empty positive set means "nothing positively baseline-
  // excluded", not "everything is baseline-excluded."
  //
  // Two empty-positive cases land here in practice:
  // 1. Consumer `exclude`-s every default baseline glob → `excludeFileGlobs`
  //    is fully empty (Sonnet R0 catch).
  // 2. Consumer `extend`-s with only `!`-prefixed entries AND `exclude`-s
  //    every default → `excludeFileGlobs` has only negatives, no positives
  //    (GCA mmnto-ai/totem#1766 R1 catch).
  // Both produce a baseline that classifies every file as baseline absent
  // this guard, suppressing all rule violations.
  const hasPositiveBaseline = baseline.excludeFileGlobs.some((g) => !g.startsWith('!'));
  if (hasPositiveBaseline && fileMatchesGlobs(filePath, baseline.excludeFileGlobs))
    return 'baseline';
  return 'in-scope';
}

// ─── Synthetic DiffAddition production ─────────────

/**
 * Convert raw file content into the `DiffAddition[]` shape the rule engine
 * expects. One addition per line. `precedingLine` carries the prior line
 * verbatim so suppression directives (`// totem-ignore-next-line`) work
 * inside the verifier the same way they do in lint. `astContext` is left
 * undefined — the engine treats undefined as "code", which is exactly the
 * Stage 4 contract: detect over-broad firing on any source line, not just
 * lines a Tree-sitter classifier labels as code.
 */
function fileToAdditions(file: string, content: string): DiffAddition[] {
  // CR mmnto-ai/totem#1757 R3: don't synthesize a trailing blank line.
  // `''.split(/\r?\n/)` returns `['']` and `'foo\n'.split(/\r?\n/)`
  // returns `['foo', '']`, both of which would inject a non-existent
  // blank addition. A pattern like `^$` (blank-line detector) would
  // then falsely fire on every newline-terminated file in the
  // codebase, flipping rules into out-of-scope or candidate-debt for
  // the wrong reason.
  if (content.length === 0) return [];
  const lines = content.split(/\r?\n/);
  if (/\r?\n$/.test(content)) {
    lines.pop();
  }
  const additions: DiffAddition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    additions.push({
      file,
      line,
      lineNumber: i + 1,
      precedingLine: i > 0 ? (lines[i - 1] ?? null) : null,
    });
  }
  return additions;
}

// ─── Rule execution ────────────────────────────────

const NOOP_LOGGER: CoreLogger = { warn: () => undefined };

function defaultRuleCtx(): RuleEngineContext {
  return {
    logger: NOOP_LOGGER,
    state: { hasWarnedShieldContext: false },
  };
}

/**
 * Run the rule against the entire codebase, with `fileGlobs` stripped so
 * the rule fires on every file (in-scope AND baseline). Stage 4 partitions
 * the resulting violations by file classification afterward. Without the
 * strip, `applyRulesToAdditions` would skip baseline files internally and
 * the verifier would see zero out-of-scope hits even when the pattern is
 * obviously over-broad.
 */
async function runRuleAgainstAllFiles(
  rule: CompiledRule,
  additions: readonly DiffAddition[],
  ctx: RuleEngineContext,
  workingDirectory: string | undefined,
): Promise<Violation[]> {
  const ruleNoScope: CompiledRule = { ...rule, fileGlobs: undefined };

  if (rule.engine === 'regex' || !rule.engine) {
    return applyRulesToAdditions(ctx, [ruleNoScope], [...additions]);
  }

  // ast / ast-grep — requires a working directory for file resolution.
  // Fail loud when absent so Stage 4 cannot silently misclassify the run
  // as `'no-matches'`. T1's CLI integration always passes a
  // workingDirectory; tests that hit this path must pass one too.
  // (CR mmnto-ai/totem#1757 R1 — earlier `return []` short-circuit
  // hid the missing-input case as a clean result.)
  if (!workingDirectory) {
    const msg = `[Totem Error] Stage 4 verifier requires deps.workingDirectory for ${rule.engine} rules.`;
    throw new Error(msg);
  }
  return applyAstRulesToAdditions(ctx, [ruleNoScope], [...additions], workingDirectory);
}

// ─── Structural equivalence ────────────────────────

/**
 * T1 uses byte-equal trimmed comparison: a violation line is `badExample`-
 * shape iff `line.trim()` equals `badExample.trim()`. Stricter equivalence
 * (full subtree match for ast-grep, normalized whitespace for regex) is
 * deferred to T5 (mmnto-ai/totem#1686) when the perf-pass adds AST-aware
 * comparison.
 *
 * `badExample` may carry multiple lines (Pipeline 3 reuses Bad snippets
 * verbatim). The function compares against ANY trimmed line of the
 * `badExample` block — a violation matches if the line equals any one of
 * the badExample's component lines.
 */
function lineMatchesBadExample(line: string, badExample: string | undefined): boolean {
  if (badExample === undefined) return false;
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) return false;
  for (const candidate of badExample.split(/\r?\n/)) {
    if (candidate.trim() === trimmedLine) return true;
  }
  return false;
}

// ─── Public API ────────────────────────────────────

/**
 * Run Stage 4 verification for a single compiled rule against the consumer's
 * codebase. Caller decides what to do with the returned outcome:
 *
 *   - `'no-matches'`           → set rule.status = 'untested-against-codebase'
 *   - `'out-of-scope'`         → archive rule with reasonCode 'stage4-out-of-scope-match'
 *   - `'in-scope-bad-example'` → set rule.status = 'active', confidence = 'high'
 *   - `'candidate-debt'`       → set rule.status = 'active', force severity = 'warning'
 *
 * The verifier itself does NOT mutate the rule. Mutation happens at the
 * compileLesson integration site so the trace event and lifecycle field
 * preservation remain centralized.
 *
 * For Pipeline 1 manual rules, the integration site bypasses Stage 4
 * entirely — those rules are human-authored and Stage 4 is a safety net
 * for LLM-generated patterns. The verifier itself is engine-agnostic and
 * will run on any rule it's handed.
 */
export async function verifyAgainstCodebase(
  rule: CompiledRule,
  baseline: Stage4Baseline,
  deps: Stage4VerifierDeps,
): Promise<Stage4VerificationResult> {
  const files = await deps.listFiles();
  const ctx = deps.ruleCtx ?? defaultRuleCtx();

  // Build all additions across all files. T5 (mmnto-ai/totem#1686) will
  // batch this across rules per compile cycle; T1 walks per-rule.
  const additions: DiffAddition[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await deps.readFile(file);
    } catch (err) {
      // Fail loud per Tenet 4. The file showed up in listFiles() so its
      // absence here is a real environment problem (race with deletion,
      // permission change, broken symlink). The operator needs to see
      // exactly which file failed; preserving `cause` keeps the original
      // stack/context intact (CR mmnto-ai/totem#1757 R2 — the prior
      // `${err.message}` concat flattened the original exception).
      throw new Error(`Stage 4 verifier could not read ${file}.`, { cause: err });
    }
    additions.push(...fileToAdditions(file, content));
  }

  if (additions.length === 0) {
    return {
      outcome: 'no-matches',
      baselineMatches: [],
      inScopeMatches: [],
      candidateDebtLines: [],
    };
  }

  const violations = await runRuleAgainstAllFiles(rule, additions, ctx, deps.workingDirectory);

  if (violations.length === 0) {
    return {
      outcome: 'no-matches',
      baselineMatches: [],
      inScopeMatches: [],
      candidateDebtLines: [],
    };
  }

  // Partition violations by file classification.
  const baselineMatchSet = new Set<string>();
  const inScopeMatchSet = new Set<string>();
  const candidateDebtLines: string[] = [];

  for (const violation of violations) {
    const classification = classifyFile(violation.file, rule.fileGlobs, baseline);
    if (classification === 'baseline') {
      baselineMatchSet.add(violation.file);
    } else {
      inScopeMatchSet.add(violation.file);
      if (!lineMatchesBadExample(violation.line, rule.badExample)) {
        candidateDebtLines.push(violation.line);
      }
    }
  }

  // Out-of-scope wins precedence over in-scope outcomes — even one baseline
  // match means the pattern is over-broad and gets archived. ADR-091
  // §"Stage 4: Verify-Against-Codebase" is explicit on this ordering.
  if (baselineMatchSet.size > 0) {
    return {
      outcome: 'out-of-scope',
      baselineMatches: [...baselineMatchSet].sort(),
      inScopeMatches: [...inScopeMatchSet].sort(),
      candidateDebtLines: [],
    };
  }

  // All violations are in-scope. Distinguish bad-example shape from
  // candidate debt by whether ANY violation line failed to match the
  // badExample. A single mismatch flips the outcome to candidate-debt;
  // the rule ships at warning severity until a human confirms the hits.
  if (candidateDebtLines.length === 0) {
    return {
      outcome: 'in-scope-bad-example',
      baselineMatches: [],
      inScopeMatches: [...inScopeMatchSet].sort(),
      candidateDebtLines: [],
    };
  }

  return {
    outcome: 'candidate-debt',
    baselineMatches: [],
    inScopeMatches: [...inScopeMatchSet].sort(),
    candidateDebtLines,
  };
}
