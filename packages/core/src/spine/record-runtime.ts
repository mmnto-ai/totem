// ─── Prop 310 V1 record grammar — RUNTIME EVALUATION (slice 2 of the V1 build) ─
//
// The § Design 12 lowering says what a construct BECOMES on the compiled rule;
// this module says what it MEANS when `totem lint` runs. Two constructs need a
// runtime semantic the shipped engine does not have:
//
//   § Design 7 — the two-array scope rule. A file is in scope iff it matches some
//                `fileGlobs` entry AND matches no `excludeGlobs` entry. Exclusion
//                is STRUCTURAL: entries are positive-form globs applied as
//                exclusions, never `!`-negation (a parse error in the grammar).
//   § Design 8 — the `requires:` two-pass. On a target match at locus L the rule
//                FIRES iff `requires.pattern` does NOT match within the declared
//                scope containing L.
//
// FREEZE / NON-REGRESSION BOUNDARY (binding): the legacy corpus (485 compiled
// rules, `.totem/compiled-rules.json`, frozen by `rule-compilation`) must keep
// matching BYTE-FOR-BYTE. Every function here is therefore gated on
// `isRecordPathRule`, and the mined-path byte-identity guard in
// `record-lower.test.ts` proves zero of the 485 legacy rules can reach a record
// branch. Nothing in this module runs `sanitizeFileGlobs`, and it never imports
// the frozen actuator.
//
// Purity: no IO, no clock, no module state. The `requires` evaluator takes the
// file text as a LAZY resolver so the caller owns the read (and so a `line`-scope
// requirement never forces one).

import type { CompiledRule } from '../compiler-schema.js';
import { TotemParseError } from '../errors.js';
import { fileMatchesGlobs, matchesRecordGlob } from '../sys/glob.js';

/**
 * The Prop 310 compiled homes, as a runtime-readable list. A rule carrying ANY
 * of them came from the record path; a rule carrying NONE is legacy.
 *
 * DERIVED, never mirrored (Tenet 20): the discriminator is the presence of the
 * § Design 12 homes themselves, not a separate `dialect:` marker field — a marker
 * would be a second, drift-capable statement of what the fields already say, and
 * § Design 4's key space is closed against inventing one.
 *
 * The derivation is SAFE because nothing but the record path can write these
 * fields: they were added to `CompiledRuleSchema` by this slice, and the only
 * other writer (the legacy lesson-compile actuator) is under the standing
 * `rule-compilation` freeze and does not regenerate. The byte-identity guard
 * asserts the empirical half — zero of the shipped 485 rules carries any of them.
 */
export const RECORD_COMPILED_HOME_KEYS = [
  'excludeGlobs',
  'requires',
  'examples',
  'language',
  'verificationShadow',
  'recoveryHint',
  'curation',
] as const satisfies readonly (keyof CompiledRule)[];

/**
 * True when a compiled rule came from the Prop 310 record path — i.e. when the
 * § Design 7 dialect, the § Design 7 two-array scope rule, and the § Design 8
 * two-pass apply to it. False for every legacy/mined rule, which keeps the
 * shipped matcher unchanged.
 */
export function isRecordPathRule(rule: CompiledRule): boolean {
  return RECORD_COMPILED_HOME_KEYS.some((key) => rule[key] !== undefined);
}

/**
 * § Design 7 — the two-array scope rule for a RECORD-path rule:
 * `positiveMatch && !excludeMatch`, both arrays evaluated under the normative
 * dialect (`matchesRecordGlob`).
 *
 * `fileGlobs` is min-1 at parse, so the empty-positive case cannot arise from a
 * well-formed record; a hand-edited manifest that produced one would match
 * NOTHING here rather than everything. That direction is deliberate — the
 * shipped `fileMatchesGlobs` treats "no positive globs" as include-everything,
 * which for a record-path rule would silently WIDEN a scope the grammar requires
 * to be declared. A rule that fires nowhere is visible; one that fires everywhere
 * is the fail-open class § Design 2 exists to kill.
 */
export function recordScopeMatchesFile(
  filePath: string,
  fileGlobs: readonly string[] | undefined,
  excludeGlobs: readonly string[] | undefined,
): boolean {
  const positives = fileGlobs ?? [];
  if (!positives.some((glob) => matchesRecordGlob(filePath, glob))) return false;
  if (excludeGlobs === undefined) return true;
  return !excludeGlobs.some((glob) => matchesRecordGlob(filePath, glob));
}

/**
 * The ONE scope predicate the rule engine asks: does this rule apply to this
 * file? Record-path rules get § Design 7's dialect + two-array rule; every other
 * rule gets the shipped `fileMatchesGlobs` predicate verbatim, including its
 * "unscoped rule applies to everything" behaviour.
 *
 * Single-homed on purpose: the engine had four separate copies of the
 * `rule.fileGlobs && rule.fileGlobs.length > 0 ? fileMatchesGlobs(...) : true`
 * expression, and four copies of a dialect fork is how a rule silently gets one
 * scope at dispatch and a different one at the fail-loud guard.
 */
export function ruleAppliesToFile(rule: CompiledRule, filePath: string): boolean {
  if (isRecordPathRule(rule)) {
    return recordScopeMatchesFile(filePath, rule.fileGlobs, rule.excludeGlobs);
  }
  if (rule.fileGlobs && rule.fileGlobs.length > 0) {
    return fileMatchesGlobs(filePath, rule.fileGlobs);
  }
  return true;
}

/**
 * The text the § Design 8 scopes resolve to at a target-match locus L.
 *
 * `file` is a LAZY resolver returning `null` when the file cannot be read: the
 * caller owns the IO, a `line`-scope requirement never triggers a read, and the
 * unreadable case gets an explicit, documented direction below rather than an
 * exception thrown from inside a matcher.
 */
export interface RequiresScopeText {
  /** L's line — the text of the line the target matched on. */
  line: string;
  /** The whole file containing L, or `null` when unreadable. */
  file: () => string | null;
}

/**
 * § Design 8 — pass two. Returns TRUE when the required context is PRESENT
 * within the declared scope containing L, i.e. when the rule must stay SILENT.
 * The rule fires iff the target matched AND this returns false.
 *
 * `requires.pattern` is a regex evaluated TEXTUALLY, independent of the target
 * engine — "the requirement is a context check, not a second matcher" — so an
 * ast-grep rule's requirement is still a plain regex over the scope text.
 *
 * UNREADABLE FILE (`scope: file` only) ⇒ context ABSENT ⇒ the rule FIRES. The
 * safe direction for a lint gate is toward flagging: a false positive is visible
 * and disputable, a suppressed real violation is silent. This mirrors the shipped
 * Rust test-span exemption, whose read failure likewise yields no exemption
 * (`rule-engine.ts`: "the exemption fails toward flagging, never toward
 * suppression").
 *
 * A `requires.pattern` that will not compile means the compile-stage gate was
 * bypassed or the manifest was hand-edited. Fail LOUD — the same treatment
 * `applyRulesToAdditions` gives an uncompilable `rule.pattern`; silently treating
 * it as "context absent" would turn a broken rule into a firing one.
 */
export function requiresContextPresent(
  rule: CompiledRule,
  requires: NonNullable<CompiledRule['requires']>,
  text: RequiresScopeText,
): boolean {
  let re: RegExp;
  try {
    re = new RegExp(requires.pattern);
  } catch (err) {
    throw new TotemParseError(
      `Rule ${rule.lessonHash} has an invalid \`requires.pattern\` and cannot be evaluated (Prop 310 § Design 8).`,
      `The record-path compile gate validates this pattern with the same safe-regex2 check it applies to the target, so an invalid one here means the manifest was hand-edited or written by a bypassed producer. Re-compile the rule record. Pattern: ${JSON.stringify(requires.pattern)}`,
      err,
    );
  }
  if (requires.scope === 'line') return re.test(text.line);
  const fileText = text.file();
  if (fileText === null) return false;
  return re.test(fileText);
}

/**
 * § Design 8 applied to one target match: TRUE when the rule must stay silent at
 * this locus because its required context is present. Always false for a rule
 * carrying no `requires` block — which is every legacy rule, so the shipped
 * evaluation path is untouched by construction.
 */
export function requiresSuppressesMatch(rule: CompiledRule, text: RequiresScopeText): boolean {
  if (rule.requires === undefined) return false;
  return requiresContextPresent(rule, rule.requires, text);
}
