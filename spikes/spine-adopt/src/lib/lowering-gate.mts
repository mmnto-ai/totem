// ─── § Lowering 4's regex engine gate, as a shared pure function ─────────────
//
// Lifted out of `src/lower.mts` UNCHANGED (same classes, same literals, same
// reason strings) because three steps now need the same verdict and none of them
// may import `src/lower.mts`: that module runs its whole lowering pass at import
// time, so importing it for one predicate would re-run the lowering as a side
// effect.
//
// `src/facts.mts` and `src/verify-records.mts` need it BEFORE `src/lower.mts`
// runs at all (`npm run all` precedes `npm run differential`), so a rejected
// record must be identifiable without the lowering artifact.

import { classify, type ExpressibilityClass, scanPattern } from './expressibility.mts';

/** The two classes RE2 rejects AT COMPILE; § Lowering 4 forbids an approximation. */
export const REJECT_CLASSES: readonly ExpressibilityClass[] = ['lookaround', 'backreference'];

export interface PatternVerdict {
  role: string;
  pattern: string;
  class: ExpressibilityClass;
  lowered: boolean;
  /** The Rego source literal, or null on a REJECT. */
  literal: string | null;
  reason: string | null;
}

/**
 * § Lowering 4 + § Lowering 3 in one place. `re2-clean` and `word-boundary` lower
 * to a JSON-escaped DOUBLE-QUOTED literal (`JSON.stringify`, the contract's named
 * `json.Marshal`-equivalent); `lookaround` and `backreference` are compile-loud
 * REJECT rows and produce no literal at all.
 *
 * The double-quoted form is what makes the 17 backtick-bearing corpus patterns
 * representable — a Rego RAW string has no escape mechanism — and `JSON.stringify`
 * re-escapes every backslash, so `\b` reaches RE2 as a word boundary instead of
 * the U+0008 the census measured a verbatim emission to produce.
 */
export function lowerPattern(role: string, pattern: string): PatternVerdict {
  const cls = classify(scanPattern(pattern));
  if (cls === 'lookaround' || cls === 'backreference') {
    return {
      role,
      pattern,
      class: cls,
      lowered: false,
      literal: null,
      reason:
        cls === 'lookaround'
          ? 'RE2 rejects lookaround AT COMPILE ("invalid or unsupported Perl syntax: `(?!`" / "invalid named capture"); § Lowering 4 forbids an approximation.'
          : 'RE2 rejects backreferences AT COMPILE ("invalid escape sequence: `\\1`"); § Lowering 4 forbids an approximation.',
    };
  }
  return {
    role,
    pattern,
    class: cls,
    lowered: true,
    literal: JSON.stringify(pattern),
    reason: null,
  };
}

/**
 * The § Lowering 4 gate applied to a COMPILED rule: the target pattern for a regex
 * record, plus the `requires` pattern when the record carries one. Exactly the two
 * roles `src/lower.mts` lowers, in the same order, so the reject rows the intake
 * emits and the ones the lowerer would emit cannot disagree.
 */
export function gatePatterns(rule: Record<string, unknown>, engine: string): PatternVerdict[] {
  const out: PatternVerdict[] = [];
  if (engine === 'regex') out.push(lowerPattern('target', String(rule.pattern)));
  const requires = rule.requires as { pattern: string } | undefined;
  if (requires) out.push(lowerPattern('requires', String(requires.pattern)));
  return out;
}
