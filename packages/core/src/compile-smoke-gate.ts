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
 * Not wired to Pipeline 1 (manual) rules in mmnto/totem#1408 - a dry-run
 * sweep lands in a follow-up ticket before the Pipeline 1 gate flips on.
 */

import type { AstGrepRule } from './ast-grep-query.js';
import { matchAstGrepPattern } from './ast-grep-query.js';
import type { CompiledRule } from './compiler-schema.js';

// ─── Types ──────────────────────────────────────────

export interface SmokeGateResult {
  /** True when the rule produced at least one match against the badExample. */
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

// ─── Engine runners ─────────────────────────────────

function runRegexGate(pattern: string, badExample: string): SmokeGateResult {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return {
      matched: false,
      matchCount: 0,
      reason: `invalid regex: ${firstLine(err instanceof Error ? err.message : String(err))}`,
    };
  }

  let matchCount = 0;
  for (const line of badExample.split('\n')) {
    if (re.test(line)) matchCount++;
  }
  return matchCount > 0 ? { matched: true, matchCount } : { matched: false, matchCount: 0 };
}

function runAstGrepGate(pattern: AstGrepRule, badExample: string): SmokeGateResult {
  const lineNumbers = lineNumbersFor(badExample);
  try {
    const matches = matchAstGrepPattern(badExample, '.ts', pattern, lineNumbers);
    return matches.length > 0
      ? { matched: true, matchCount: matches.length }
      : { matched: false, matchCount: 0 };
  } catch (err) {
    return {
      matched: false,
      matchCount: 0,
      reason: `ast-grep runtime error: ${firstLine(err instanceof Error ? err.message : String(err))}`,
    };
  }
}

// ─── Public API ─────────────────────────────────────

/**
 * Run the smoke gate for a compiled rule. Returns a `SmokeGateResult` so the
 * caller can decide whether to accept or reject the rule. The caller is
 * responsible for the "zero matches means reject" decision; this function
 * only reports what the engine says.
 */
export function runSmokeGate(rule: CompiledRule, badExample: string): SmokeGateResult {
  if (!badExample || badExample.trim().length === 0) {
    return { matched: false, matchCount: 0 };
  }

  if (rule.engine === 'regex') {
    return runRegexGate(rule.pattern, badExample);
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
    return runAstGrepGate(source, badExample);
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
