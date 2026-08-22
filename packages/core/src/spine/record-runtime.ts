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

import * as path from 'node:path';

import type { CompiledRule } from '../compiler-schema.js';
import { TotemParseError } from '../errors.js';
import { validateRegex } from '../regex-validation.js';
import { BoundedRegexCache, fileMatchesGlobs, matchesRecordGlob } from '../sys/glob.js';

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
 * § Design 7 dialect and its two-array scope rule apply to it. False for every
 * legacy/mined rule, which keeps the shipped matcher unchanged.
 *
 * The test is `examples !== undefined` ALONE, deliberately narrower than "any
 * § Design 12 home" (falsification round, 2026-08-21). `examples` is the EXACT
 * discriminator, not merely a sufficient one:
 *   - § Design 5 makes it non-omittable and min-1, so EVERY record carries it;
 *   - `compileRuleRecord` emits it unconditionally, so every lowered rule has it;
 *   - it is the one home no other construct can be present without.
 *
 * The wider seven-key disjunction was demonstrated to be UNSAFE in the other
 * direction: a legacy-shaped rule that ever gained just a `recoveryHint` — a
 * plausible future addition to the mined path, and a purely cosmetic one — would
 * silently flip from the shipped tree-wide matcher to the record dialect's
 * root-only reading of the same `*.ts` glob, narrowing its scope with no signal.
 * Keying on the field that MEANS "this is a record" removes that coupling
 * between a diagnostic field and a matcher semantic.
 *
 * `RECORD_COMPILED_HOME_KEYS` remains the full home set for the corpus guard
 * (which asserts the legacy manifest carries NONE of them — a stronger claim
 * than this predicate needs, and the right one for a freeze check).
 */
export function isRecordPathRule(rule: Pick<CompiledRule, 'examples'>): boolean {
  return rule.examples !== undefined;
}

/**
 * The exemplar lines a rule's Stage-4 / doctor readers treat as "the authored bad
 * example", single-homed (Tenet 20).
 *
 * Prop 310 slice 3 discharges the slice-2 pin: a record rule's authored preimages
 * live in `examples[i].bad` — the § Design 10 EDITABLE home — and are NOT mirrored
 * onto the legacy `badExample` field, so every reader of that field would otherwise
 * read a record rule as having no bad example at all. Both shipped readers now ask
 * this one function instead:
 *
 *   - Stage 4 (`lineMatchesBadExample`) — a matched line equal to any of these
 *     classifies `in-scope-bad-example` rather than `candidate-debt`;
 *   - `totem doctor`'s `no-badExample` grandfathering reason — an empty result is
 *     exactly the old `!badExample || badExample.trim() === ''` test.
 *
 * BLANK LINES ARE DROPPED, which is what makes both of those byte-identical for
 * legacy rules: Stage 4 already refuses to match an empty trimmed line, and a
 * whitespace-only `badExample` must still count as absent for doctor.
 */
export function ruleBadExampleLines(rule: Pick<CompiledRule, 'badExample' | 'examples'>): string[] {
  const blocks: string[] = [];
  if (isRecordPathRule(rule)) {
    for (const example of rule.examples ?? []) blocks.push(example.bad);
  } else if (rule.badExample !== undefined) {
    blocks.push(rule.badExample);
  }
  return blocks.flatMap((block) => block.split(/\r?\n/)).filter((line) => line.trim().length > 0);
}

/**
 * Exactly the fields the scope predicates READ. Structural rather than the whole
 * `CompiledRule` so callers holding a projection — Stage 4's `classifyFile`
 * takes one — pass it directly instead of casting a narrower object back to the
 * full type. A cast there would have been a lie the compiler stopped checking.
 */
export type RuleScopeFields = Pick<CompiledRule, 'fileGlobs' | 'excludeGlobs' | 'examples'>;

/**
 * § Design 12 — fail loud on a TORN record rule: one carrying a Prop 310
 * compiled home but no `examples`.
 *
 * Such a rule cannot exist downstream of the lowering (`examples` is min-1 at
 * parse and emitted unconditionally) nor in the frozen legacy corpus (which
 * carries no home at all), so this only ever catches a hand-edited manifest or
 * a bypassed producer. Left unchecked, `isRecordPathRule` would class it LEGACY
 * and its `excludeGlobs` and `requires` would be dropped — a scope silently
 * widened and a requirement silently unevaluated. The drop direction is toward
 * flagging, so it is not fail-open, but § Design 12's ban on accepting a
 * construct and dropping it is a ban on the SILENCE, not just on the unsafe
 * direction. Fail loud instead.
 *
 * Called at dispatcher altitude, once per invocation — the same altitude as the
 * tree-sitter `requires` backstop, and for the same reason: a per-file check
 * would re-report the same defect on every file.
 */
export function assertNoTornRecordRules(rules: readonly CompiledRule[]): void {
  const torn = rules.find(
    (rule) =>
      rule.examples === undefined &&
      RECORD_COMPILED_HOME_KEYS.some((key) => rule[key] !== undefined),
  );
  if (torn === undefined) return;
  const homes = RECORD_COMPILED_HOME_KEYS.filter((key) => torn[key] !== undefined);
  throw new TotemParseError(
    `Rule ${torn.lessonHash} (${torn.lessonHeading}) carries Prop 310 record field(s) [${homes.join(', ')}] but no \`examples\`, so it can be classified neither as a record rule nor as a legacy one.`,
    'Prop 310 § Design 5 makes `examples` non-omittable and the record lowering always emits it, so this manifest was hand-edited or written by a bypassed producer. Re-compile the rule record. Left unclassified, its `excludeGlobs` would be ignored and its `requires` never evaluated.',
  );
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
export function ruleAppliesToFile(rule: RuleScopeFields, filePath: string): boolean {
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
 * Compiled `requires.pattern` instances, LRU-bounded and shared across every
 * dispatcher. Keyed by pattern SOURCE, so two rules declaring the same
 * requirement share one compilation and a manifest reload does not leak.
 */
const REQUIRES_PATTERN_CACHE_CAPACITY = 512;
const requiresPatternCache = new BoundedRegexCache(REQUIRES_PATTERN_CACHE_CAPACITY);

/**
 * Path-containment check for the § Design 8 whole-file readers.
 *
 * The paths handed to these readers come out of a DIFF, which is
 * attacker-shaped input on any path where a lint runs over untrusted contributed
 * changes — a `../` prefix would otherwise read outside the repo. `path.relative`
 * rather than `startsWith` on purpose: the string form admits the
 * sibling-directory bypass (`/app-secrets` passing a `/app` prefix test), which
 * is the same reasoning the shipped ast-path containment checks use.
 *
 * An out-of-root path is reported as UNREADABLE, not as an error: the requirement
 * is then unmet and the rule FIRES, preserving the fail-toward-flagging direction
 * every other read failure on this path takes.
 */
export function isInsideRoot(root: string, filePath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, path.resolve(resolvedRoot, filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Evaluate a compiled requirement against the declared § Design 8 scope. */
function matchesInScope(re: RegExp, scope: 'line' | 'file', text: RequiresScopeText): boolean {
  if (scope === 'line') return re.test(text.line);
  const fileText = text.file();
  if (fileText === null) return false;
  return re.test(fileText);
}

/**
 * § Design 8 — gate every `requires.pattern` in the loaded manifest through the
 * SAME safe-regex2 check the compile path applies, before any of them is
 * evaluated.
 *
 * The lowering already gates this, so a pattern reaching here unsafe means the
 * manifest was hand-edited or written by a bypassed producer. Left ungated it is
 * a live ReDoS surface, and a worse one than the target pattern's: at
 * `scope: file` the requirement runs against WHOLE-FILE text, unbounded, on the
 * pre-commit path. `validateRegex` is the same single-homed check the compile
 * gate uses, so the two can never drift.
 *
 * Dispatcher altitude, once per invocation — the same reason as
 * `assertNoTornRecordRules`: a per-match check would re-report one defect on
 * every line of every file.
 */
export function assertRequiresPatternsSafe(rules: readonly CompiledRule[]): void {
  for (const rule of rules) {
    if (rule.requires === undefined) continue;
    const validation = validateRegex(rule.requires.pattern);
    if (validation.valid) continue;
    throw new TotemParseError(
      `Rule ${rule.lessonHash} (${rule.lessonHeading}) has an unusable \`requires.pattern\` (${validation.reason ?? 'invalid regex pattern'}) and cannot be evaluated (Prop 310 § Design 8).`,
      `The record-path compile gate runs this exact safe-regex2 check, so a pattern that fails it here means the manifest was hand-edited or written by a bypassed producer. Re-compile the rule record. At \`scope: file\` this pattern would run against whole-file text. Pattern: ${JSON.stringify(rule.requires.pattern)}`,
    );
  }
}

/**
 * § Design 8 — fail loud on `ast-grep` + `requires.scope: line`.
 *
 * The lowering REJECTS this combination (an ast-grep match is a span, and
 * reading it as its start line makes the verdict depend on source formatting),
 * but a hand-edited manifest can still carry it, and the ast dispatcher would
 * silently evaluate `match.lineText` — shipping exactly the formatting-dependent
 * semantic the ruling refused. Mirrors the tree-sitter `requires` backstop:
 * unreachable from any compiled record, unreachable from the legacy corpus,
 * live only against a torn manifest.
 */
export function assertNoAstGrepLineScope(rules: readonly CompiledRule[]): void {
  const offender = rules.find(
    (rule) => rule.engine === 'ast-grep' && rule.requires?.scope === 'line',
  );
  if (offender === undefined) return;
  throw new TotemParseError(
    `Rule ${offender.lessonHash} (${offender.lessonHeading}) carries \`requires.scope: line\` on the \`ast-grep\` engine, a combination the record lowering rejects.`,
    "Prop 310 § Design 8: an ast-grep match is a SPAN, and reading it as its start line makes the verdict depend on source formatting rather than on the rule. No rule record can compile to this shape, so the manifest was hand-edited or written by a bypassed producer. Use `scope: file`, move the requirement into the payload's own `not:`/`has:` combinators, or wait for the reserved `block` unit.",
  );
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
  // Compiled once per distinct pattern, not once per MATCH: this runs on every
  // target hit of every requires-carrying rule, and at `scope: file` against
  // whole-file text. The pattern set is manifest-bounded, and the LRU bound keeps
  // a long-lived process (the MCP server, a watch loop) from growing a map keyed
  // by rule content.
  let re = requiresPatternCache.get(requires.pattern);
  if (re !== undefined) {
    return matchesInScope(re, requires.scope, text);
  }
  try {
    re = new RegExp(requires.pattern);
    requiresPatternCache.set(requires.pattern, re);
  } catch (err) {
    throw new TotemParseError(
      `Rule ${rule.lessonHash} has an invalid \`requires.pattern\` and cannot be evaluated (Prop 310 § Design 8).`,
      `The record-path compile gate validates this pattern with the same safe-regex2 check it applies to the target, so an invalid one here means the manifest was hand-edited or written by a bypassed producer. Re-compile the rule record. Pattern: ${JSON.stringify(requires.pattern)}`,
      err,
    );
  }
  return matchesInScope(re, requires.scope, text);
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
