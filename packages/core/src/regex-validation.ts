// ─── The safe-regex2 gate, as an import-graph LEAF ───────────────────────────
//
// `validateRegex` was defined in `compiler.ts` and is still re-exported from
// there, so every shipped consumer's import is unchanged. It lives here because
// `compiler.ts` imports `rule-engine.ts`, and the rule engine now needs this
// gate at dispatcher altitude (Prop 310 § Design 8's runtime `requires.pattern`
// check) — importing it back out of `compiler.ts` would close a cycle
// (`rule-engine` → `spine/record-runtime` → `compiler` → `rule-engine`).
//
// This module imports only `safe-regex2` and a type, so it can be pulled from
// anywhere. Moving the function rather than duplicating the check is the point:
// the compile gate and the runtime gate MUST be the same predicate, or a pattern
// the compiler refuses becomes one the runtime happily executes.

import safeRegex from 'safe-regex2';

import type { RegexValidation } from './compiler-schema.js';

/**
 * Validate that a pattern string is a syntactically valid RegExp
 * and is not vulnerable to ReDoS (catastrophic backtracking).
 */
export function validateRegex(pattern: string): RegexValidation {
  try {
    new RegExp(pattern);
    // totem-context: not a swallow — the failure is REPORTED as this function's return value (`{valid:false}`), which every caller checks and fails loud on. Converting the throw into a checked result is the whole contract; re-throwing would make the gate uncallable as a predicate. Byte-identical to the pre-existing `compiler.ts` implementation this moved from.
  } catch {
    return { valid: false, reason: 'invalid syntax' };
  }

  if (!safeRegex(pattern)) {
    return { valid: false, reason: 'ReDoS vulnerability detected' };
  }

  return { valid: true };
}
