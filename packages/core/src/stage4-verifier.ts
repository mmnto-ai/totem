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
import { applyAstRulesToAdditions, applyRulesToAdditions } from './rule-engine.js';

// ─── Types ──────────────────────────────────────────

export interface Stage4Baseline {
  /**
   * Glob patterns the rule MUST NOT fire on. Files matching any of these
   * globs are part of the verification baseline — a match on one of them
   * is evidence the pattern is over-broad. T1 ships with `DEFAULT_BASELINE_GLOBS`
   * (test + fixture patterns); T2 (mmnto-ai/totem#1683) layers consumer
   * `extend` / `exclude` overrides via `review.stage4Baseline` config.
   *
   * Files outside the rule's `fileGlobs` scope are implicitly in the baseline
   * — no need to list them here. The verifier computes the implicit case
   * from `rule.fileGlobs` at evaluation time.
   */
  readonly excludeFileGlobs: readonly string[];
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

export function getDefaultBaseline(): Stage4Baseline {
  // T1: the default baseline is rule-independent (every rule gets the same
  // test/fixture exclusion). T2 (mmnto-ai/totem#1683) introduces per-config
  // `extend`/`exclude` overrides; the function signature accepts a rule
  // parameter then so per-rule baseline derivation can layer on top.
  return { excludeFileGlobs: DEFAULT_BASELINE_GLOBS };
}

// ─── Glob matching (matches rule-engine semantics) ─

function matchesGlob(filePath: string, glob: string): boolean {
  // Normalize Windows backslashes to forward slashes — globs use forward
  // slashes universally, repo paths come back from git-ls-files in either
  // shape on Windows depending on core.autocrlf.
  const normalized = filePath.replace(/\\/g, '/');

  // Exact glob match — escape regex metacharacters except `*`, `?`, and
  // brace groups, then expand `**` to `.*`, `*` to `[^/]*`, `?` to `.`.
  if (glob.includes('*') || glob.includes('?') || glob.includes('{')) {
    const regexPattern = globToRegex(glob);
    return new RegExp(`^${regexPattern}$`).test(normalized);
  }

  // Literal filename match (e.g., "Dockerfile")
  return normalized === glob || normalized.endsWith('/' + glob);
}

function globToRegex(glob: string): string {
  let result = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        result += '.*';
        i += 2;
        // Consume trailing `/` if present so `**/foo` becomes `.*foo`
        if (glob[i] === '/') i++;
        continue;
      }
      result += '[^/]*';
    } else if (ch === '?') {
      result += '[^/]';
    } else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        result += '\\{';
      } else {
        const alts = glob.slice(i + 1, end).split(',');
        result += '(?:' + alts.map(escapeRegex).join('|') + ')';
        i = end + 1;
        continue;
      }
    } else if ('.+()[]^$|\\'.includes(ch)) {
      result += '\\' + ch;
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.+()[\]^$|\\*?{}]/g, '\\$&');
}

function fileMatchesAnyGlob(filePath: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchesGlob(filePath, g));
}

/**
 * A file is "in scope" for Stage 4 verification when it matches the rule's
 * declared `fileGlobs` (or has none, meaning the rule applies everywhere)
 * AND is not in the baseline-excluded set. A baseline-excluded test file
 * inside `**\/*.ts` scope counts as baseline, not in-scope, because the
 * verifier's job is to detect over-broad firing — including on tests the
 * rule is supposed to skip.
 */
function classifyFile(
  filePath: string,
  ruleFileGlobs: readonly string[] | undefined,
  baseline: Stage4Baseline,
): 'in-scope' | 'baseline' {
  // Rule has explicit fileGlobs and this file doesn't match → baseline (out-of-scope).
  if (ruleFileGlobs && ruleFileGlobs.length > 0) {
    const positive = ruleFileGlobs.filter((g) => !g.startsWith('!'));
    const negative = ruleFileGlobs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
    const matchesPositive = positive.length === 0 || fileMatchesAnyGlob(filePath, positive);
    const matchesNegative = fileMatchesAnyGlob(filePath, negative);
    if (!matchesPositive || matchesNegative) return 'baseline';
  }
  // File matches rule scope (or rule has no scope). Now check baseline overrides.
  if (fileMatchesAnyGlob(filePath, baseline.excludeFileGlobs)) return 'baseline';
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
