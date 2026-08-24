/**
 * Compile-time smoke gate for compiled rules (ADR-087).
 *
 * Runs a freshly built `CompiledRule` against its own `badExample` snippet
 * using the same engine entry points that the runtime uses (`matchAstGrepPattern`
 * for ast-grep, `new RegExp` for regex). If the rule cannot match its own
 * bad example, something structurally wrong happened between the LLM output
 * and the persisted rule shape — either the pattern does not compile against
 * the snippet, or the snippet does not exercise the pattern the prompt
 * promised. Either way, the rule has no business in compiled-rules.json.
 *
 * The gate is intentionally a thin wrapper: its entire purpose is to
 * guarantee that a rule passing here will also fire at runtime on identical
 * input. Any divergence between "smoke gate happy" and "runtime happy" is a
 * bug in this module, not a rule authoring problem.
 *
 * Prop 310 § Design 8 PASS TWO (mmnto-ai/totem#2678): the match predicate is
 * "the target matched AND the required context is ABSENT", so a gate that ran
 * only pass one WAS that divergence — a `requires:`-bearing record's `good`
 * example keeps the target and adds the companion, so the gate read it as
 * over-matching and no such record could pass `totem rule test` or the ADR-112
 * §4 preimage differential. The gate therefore evaluates the requirement with
 * the RUNTIME'S OWN evaluator (`requiresSuppressesMatch`, `spine/record-runtime.ts`)
 * — the same function `rule-engine.ts` and `regex-safety/apply-rules-bounded.ts`
 * call. One evaluator, never a second implementation of § Design 8 living here
 * (Tenet 20: derive or couple, never mirror). Legacy rules carry no `requires`
 * and are byte-identical by construction — every call site is guarded on
 * `rule.requires !== undefined` so no legacy rule pays a second test.
 *
 * Borrowing the evaluator means borrowing its PRECONDITIONS: `runSmokeGate` runs
 * `assertNoTornRecordRules` / `assertRequiresPatternsSafe` /
 * `assertNoAstGrepLineScope` on a `requires:`-bearing rule before evaluating it,
 * exactly as every runtime dispatcher does at invocation altitude. Without them
 * the gate ACCEPTED rules the runtime refuses — an unsafe-but-compilable
 * `requires.pattern` that backtracks catastrophically, and `ast-grep` +
 * `requires.scope: line` — which is the same gate-vs-runtime divergence this
 * module exists to rule out.
 *
 * Not wired to Pipeline 1 (manual) rules in mmnto/totem#1408 - a dry-run
 * sweep lands in a follow-up ticket before the Pipeline 1 gate flips on.
 */

import type { AstGrepMatch, AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPattern, TRAILING_EXT_RE } from './ast-grep-query.js';
import type { CompiledRule } from './compiler-schema.js';
import { TotemParseError } from './errors.js';
import {
  assertNoAstGrepLineScope,
  assertNoTornRecordRules,
  assertRequiresPatternsSafe,
  requiresSuppressesMatch,
} from './spine/record-runtime.js';

// ─── Types ──────────────────────────────────────────

export interface SmokeGateResult {
  /** True when the rule produced at least one match against the snippet. */
  matched: boolean;
  /** Number of matches the engine reported. Zero when `matched` is false. */
  matchCount: number;
  /**
   * When matched is false and the engine refused to execute (invalid regex,
   * ast-grep runtime throw, missing engine fields), this carries the first
   * line of the error so the caller can build a human-readable rejectReason.
   * Absent when matched is true, and absent when matched is false due to the
   * snippet simply not containing anything the pattern would match.
   */
  reason?: string;
}

// ─── Helpers ────────────────────────────────────────

function firstLine(message: string): string {
  const m = /^[^\n]*/.exec(message);
  return (m?.[0] ?? message).trim();
}

function lineNumbersFor(snippet: string): number[] {
  const lineCount = snippet.split('\n').length;
  const result: number[] = [];
  for (let i = 1; i <= lineCount; i++) result.push(i);
  return result;
}

/**
 * Prop 310 § Design 8 pass two at ONE target-match locus, for the gate.
 *
 * The snippet IS the file for a gate run — the exemplar is the whole text the
 * rule is being asked about — so `scope: file` resolves to the entire snippet
 * and `scope: line` to the matched line. The `file` resolver is the snippet
 * itself rather than a read, which is what makes the gate PURE where the runtime
 * dispatchers hand `requiresSuppressesMatch` a lazy disk read.
 *
 * Guarded on `rule.requires !== undefined` so a legacy rule never pays a second
 * `re.test`, and so this is provably a no-op for the frozen 485-rule corpus.
 *
 * THROWS `TotemParseError` on an uncompilable `requires.pattern` — unreachable
 * from any compiled record (the lowering gates it with the same safe-regex2
 * check), reachable from a hand-built `CompiledRule`. Deliberately not caught
 * here: `runSmokeGate` catches it once, in one place, for both engines.
 */
function suppressedByRequires(rule: CompiledRule, line: string, snippet: string): boolean {
  if (rule.requires === undefined) return false;
  return requiresSuppressesMatch(rule, { line, file: () => snippet });
}

// ─── Engine runners ─────────────────────────────────

function runRegexGate(rule: CompiledRule, snippet: string): SmokeGateResult {
  let re: RegExp;
  try {
    re = new RegExp(rule.pattern);
  } catch (err) {
    return {
      matched: false,
      matchCount: 0,
      reason: `invalid regex: ${firstLine(err instanceof Error ? err.message : String(err))}`,
    };
  }

  let matchCount = 0;
  for (const line of snippet.split('\n')) {
    // The FULL match predicate, exactly as `rule-engine.ts`'s regex dispatcher
    // states it: target hit AND required context absent. A line whose
    // requirement is satisfied is not a match at all, so it never reaches the
    // count.
    if (re.test(line) && !suppressedByRequires(rule, line, snippet)) matchCount++;
  }
  return matchCount > 0 ? { matched: true, matchCount } : { matched: false, matchCount: 0 };
}

/**
 * Collect the ordered list of file extensions the ast-grep engine could use
 * when parsing the badExample. Extracts the trailing extension from every
 * positive `fileGlobs` entry; if no globs declare an extension at all,
 * returns a broad TS/JS default set so an unscoped rule still has a chance
 * to match the snippet under some parser.
 *
 * Why a list rather than a single extension: `.ts` and `.tsx` select
 * different tree-sitter parsers that reject each other's syntax. A TS
 * angle-bracket cast (`const x = <Foo>bar;`) parses as TS but not as TSX;
 * a JSX element parses as TSX but not as TS. If the rule's fileGlobs
 * allow multiple extensions, runtime will pick whichever matches the real
 * file, so the gate must try every declared extension too. Passing on ANY
 * extension is sufficient — runtime scans the same surface.
 *
 * Registry-backed (#1654 fix): pre-fix this function used a hardcoded
 * TS/JS regex, which silently fell back to the default set for every
 * non-TS/JS rule (e.g., a `**\/*.rs`-scoped rule). Runtime would dispatch
 * the rule against `.rs` files but the smoke gate would parse the
 * badExample under TSX — a verdict-vs-runtime divergence that masked
 * grammar-mismatched rules. Now: any trailing-extension token is
 * captured and runtime's `extensionToLang` filters out unmapped
 * extensions inside `matchAstGrepPattern`, so an unmapped extension
 * cleanly returns zero matches without ever parsing under the wrong
 * grammar.
 */
function inferBadExampleExts(rule: CompiledRule): string[] {
  const exts = new Set<string>();
  for (const g of rule.fileGlobs ?? []) {
    if (g.startsWith('!')) continue;
    const match = g.match(TRAILING_EXT_RE);
    if (match) exts.add(`.${match[1]!.toLowerCase()}`);
  }
  // Unscoped or no-extension rule: try the full TS/JS supported set so
  // the gate does not false-reject on a snippet that would match under
  // some parser. Order puts TypeScript first (handles cast syntax),
  // then TSX, then JS variants. Parity with runtime is preserved
  // because runtime also executes the rule against any file whose
  // extension matches.
  return exts.size > 0 ? [...exts] : ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
}

function runAstGrepGate(
  pattern: AstGrepRule,
  snippet: string,
  rule: CompiledRule,
): SmokeGateResult {
  const lineNumbers = lineNumbersFor(snippet);
  let lastReason: string | undefined;
  for (const ext of inferBadExampleExts(rule)) {
    // Seeded EMPTY so a throwing extension needs no statement inside the catch:
    // the filter below yields nothing, the loop moves to the next extension, and
    // the shipped degrade-to-`lastReason` behaviour is unchanged.
    let matches: AstGrepMatch[] = [];
    try {
      matches = matchAstGrepPattern(snippet, ext, pattern, lineNumbers);
    } catch (err) {
      lastReason = `ast-grep runtime error: ${firstLine(err instanceof Error ? err.message : String(err))}`;
    }
    // § Design 8 pass two, OUTSIDE the engine try/catch on purpose: a
    // `requires.pattern` that will not compile is not an ast-grep runtime error
    // and must not be reported as one. It propagates to `runSmokeGate`'s single
    // catch, which names it for what it is.
    const unsuppressed = matches.filter(
      (match) => !suppressedByRequires(rule, match.lineText, snippet),
    );
    // Zero UNSUPPRESSED matches under this extension is a miss like any other:
    // fall through to the next extension, because the gate still passes on ANY
    // extension (runtime scans the same surface).
    if (unsuppressed.length > 0) {
      return { matched: true, matchCount: unsuppressed.length };
    }
  }
  return lastReason
    ? { matched: false, matchCount: 0, reason: lastReason }
    : { matched: false, matchCount: 0 };
}

// ─── Public API ─────────────────────────────────────

/**
 * Run the smoke gate for a compiled rule against an arbitrary snippet.
 * Callers interpret `matched === true` based on the snippet's role:
 *   - badExample check: under-matching when matched is false → reject
 *   - goodExample check (mmnto-ai/totem#1580): over-matching when matched
 *     is true → reject
 *
 * This function is intentionally role-agnostic and only reports what the
 * engine says; the accept/reject decision belongs to the caller.
 */
export function runSmokeGate(rule: CompiledRule, snippet: string): SmokeGateResult {
  if (!snippet || snippet.trim().length === 0) {
    return { matched: false, matchCount: 0 };
  }

  try {
    if (rule.requires !== undefined) {
      // The evaluator's PRECONDITIONS, taken with the evaluator (Tenet 20: a
      // borrowed function borrows its contract too). Every runtime dispatcher
      // runs these three at invocation altitude before any
      // `requiresSuppressesMatch` — `rule-engine.ts` for both the regex and the
      // ast paths, `regex-safety/apply-rules-bounded.ts` for the bounded one —
      // so a gate that skipped them accepted rules the runtime REFUSES:
      //   - an unsafe-but-compilable `requires.pattern` (`(a+)+$`) that runs to
      //     catastrophic backtracking here, unbounded, against whole-snippet
      //     text — `totem rule test` reaches this with no safe-regex2 pass of
      //     its own;
      //   - `ast-grep` + `requires.scope: line`, which the lowering rejects and
      //     `assertNoAstGrepLineScope` refuses at runtime;
      //   - a TORN rule carrying `requires` with no `examples`, which
      //     `isRecordPathRule` would silently class as legacy.
      // Guarded on `requires` because it is the ONLY § Design 12 home this gate
      // reads: a rule with no requirement reaches no evaluator here, so the torn
      // check has nothing to protect and legacy rules stay byte-identical.
      assertNoTornRecordRules([rule]);
      assertRequiresPatternsSafe([rule]);
      assertNoAstGrepLineScope([rule]);
    }
    return dispatchEngineGate(rule, snippet);
  } catch (err) {
    // The ONE handler for § Design 8's fail-loud arm, shared by all three
    // preconditions and by both engines' evaluation (`requiresSuppressesMatch`
    // throws the same type on an uncompilable pattern). A gate that propagated
    // any of them would crash `totem rule test` instead of reporting the rule as
    // unusable; each message already names the construct at fault
    // (`requires.pattern` / `requires.scope: line` / `examples`), so the prefix
    // stays generic rather than claiming a cause it did not check. Mirrors the
    // `invalid regex:` shape the target pattern already gets. Anything else is a
    // real bug: rethrow.
    if (err instanceof TotemParseError) {
      return {
        matched: false,
        matchCount: 0,
        reason: `requires precondition failed: ${firstLine(err.message)}`,
      };
    }
    throw err;
  }
}

/** Engine dispatch for `runSmokeGate`, split out so the § Design 8 catch wraps both engines exactly once. */
function dispatchEngineGate(rule: CompiledRule, snippet: string): SmokeGateResult {
  if (rule.engine === 'regex') {
    return runRegexGate(rule, snippet);
  }

  if (rule.engine === 'ast-grep') {
    const source: AstGrepRule | undefined =
      rule.astGrepPattern ?? (rule.astGrepYamlRule as AstGrepRule | undefined);
    if (!source) {
      return {
        matched: false,
        matchCount: 0,
        reason: 'ast-grep rule missing both astGrepPattern and astGrepYamlRule',
      };
    }
    return runAstGrepGate(source, snippet, rule);
  }

  // Tree-sitter ast engine: not wired into the gate in mmnto/totem#1408.
  // Callers should not pass 'ast' rules; surface a neutral skip so the
  // caller can fall back to legacy verification.
  return {
    matched: false,
    matchCount: 0,
    reason: `smoke gate does not yet cover engine: ${rule.engine}`,
  };
}
