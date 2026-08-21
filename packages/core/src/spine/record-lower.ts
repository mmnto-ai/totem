// ─── Prop 310 V1 record grammar — the LOWERING (slice 2 of the V1 build) ──────
//
// Slice 1 (`rule-record.ts`) turns record bytes into a validated
// `ParsedRuleRecord`. This module turns that value into a `CompiledRule`. It is
// the § Design 1 seam replacement for records: the record path does NOT go
// through `extractManualPattern` or `CompileInputCandidate.dslSource`, because
// the record is ALREADY parsed — re-serializing it into lesson markdown just to
// re-parse it would reintroduce the incumbent grammar this proposal supersedes.
// What is reused is the VALIDATORS (`validateRegex`, `validateAstGrepPattern`)
// and the field builder (`engineFields`), never the parser and never the frozen
// `LessonInput` actuator.
//
// § Design 12 (R2) is this slice's charter: **every construct the parser admits
// either lands on the compiled record or fails compile LOUD.** No construct is
// accepted at parse and dropped at compile. That obligation is enforced
// mechanically here, not by inspection — see § "Total lowering, mechanically".
//
// ── OPERATOR RULING 2026-08-21 (tree-form) ───────────────────────────────────
//
// `target.rule` is the ast-grep RULE TREE, not a whole NapiConfig — the
// exemplar-faithful reading of § Design 4's "NapiConfig subset" (its exemplar
// shows `rule: {kind: catch_clause, not: {...}}`, a rule tree, with `language`
// living one level up at `target.language`).
//
//   - LOWERING DERIVES the NapiConfig wrapper: `{rule: <tree>, language: <napi
//     language derived from the resolved `target.language`>}`. The record
//     therefore never carries a duplicate language home (§ Design 3's no-mirror
//     discipline; Tenet 20) and no language COLLISION between the payload
//     interior and `target.language` is representable.
//   - `constraints` / `utils` are INEXPRESSIBLE at V1 (censused: zero of the 19
//     compound corpus rules use them). Demand becomes a typed `construct-gap` at
//     the R14 trial plus a grammar version bump giving each its own SIBLING home
//     under `target:` — never a silent smuggle inside the rule tree, which is
//     why the tree gate below names them explicitly instead of leaving them to
//     napi's generic unknown-field error.
//
// Grounds of record: the spec-normative exemplar (§ Design 14's normativity
// flip), language-collision avoidance, and zero corpus cost.
//
// ── Identity ─────────────────────────────────────────────────────────────────
//
// Identity is an INPUT, never minted here (§ Design 3 / R17): the ADR-112 §8
// producer mints `ruleId` at the intake seam and slice 3 threads it in. This
// function asserts it is well-formed and makes it the compiled identity
// (`lessonHash ← ruleId`, the §8/§9 `firingLabelId ← ruleId` unification), and
// NEVER hashes `dslSource` — there is no `dslSource` on this path, and a
// content-derived id would orphan the rule's ground-truth labels on every
// matcher edit.
//
// ── Freeze boundary ──────────────────────────────────────────────────────────
//
// `sanitizeFileGlobs` is NEVER called here. The record's globs were validated at
// parse against § Design 7's strict dialect and are carried BYTE-VERBATIM:
// brace expansion and shallow-glob promotion are exactly the silent transforms
// the grammar kills (§ Design 7's conformance-scope paragraph), while the
// sanitizer's tolerant behaviour for the FROZEN legacy lesson corpus is
// untouched — the freeze covers that path and nothing regenerates it.

import { extensionToLanguage, registeredExtensions } from '../ast-classifier.js';
import { extensionToLang } from '../ast-grep-query.js';
import { validateAstGrepPattern } from '../compile-lesson.js';
import { engineFields, validateRegex } from '../compiler.js';
import { CompiledRuleSchema } from '../compiler-schema.js';
import { AUTHORED_RULE_ID_RE } from './authored-rule.js';
import type { CompileOutcome } from './compile.js';
import type { ParsedRuleRecord, RuleRecord, RuleScope, RuleTarget } from './rule-record.js';

// ── § Design 6 — language resolution ─────────────────────────────────────────
//
// The Existing-Surface Coupling table's language-resolution row says this seam
// **moves**: V1 validates the payload under the SINGLE declared `language:`
// instead of trying every glob-derived Lang, and the Map-backed registry
// (built-ins + pack contributions) stays the resolution authority. The shipped
// try-each-Lang cross-grammar acceptance (mmnto-ai/totem#1654) is what that
// replaces — on the RECORD path only; the legacy path keeps it verbatim.

/** A `target.language` token resolved against the registry, or the reason it did not. */
export type RecordLanguageResolution =
  | {
      resolved: true;
      /** The declared token, confirmed registered. Resolution is MEMBERSHIP, so this equals `target.language`. */
      language: string;
      /**
       * A registered extension mapping to `language`, used to pin the ast-grep
       * validator to exactly this grammar (see `languageProbeGlobs`).
       */
      extension: string;
    }
  | { resolved: false; reason: string };

/**
 * Resolve `target.language` against the registry, using `extensionToLanguage` as
 * the authority verbatim (§ Design 6). Deterministic: `registeredExtensions()`
 * returns a sorted snapshot, so the representative extension for a language with
 * several (`.ts`/`.mts`/`.cts` → `typescript`) is always the same one — and every
 * extension of one language maps to the same napi grammar anyway, so the pick
 * cannot change the validation verdict, only the diagnostic.
 *
 * An unresolvable language FAILS LOUD (§ Design 6 / § Failure modes: "Unresolvable
 * `language:` at compile — hard error"). It is surfaced as a `rejected` outcome
 * rather than a throw, matching the incumbent's treatment of every other
 * authored-content validation failure: `rejected` is a counted, reported,
 * NON-silent state, while throws are reserved for producer-contract violations
 * (a malformed id, a payload/type divergence) — see `compileRuleRecord`.
 */
export function resolveRecordLanguage(language: string): RecordLanguageResolution {
  const extensions = registeredExtensions();
  const extension = extensions.find((ext) => extensionToLanguage(ext) === language);
  if (extension === undefined) {
    const known = [...new Set(extensions.map((ext) => extensionToLanguage(ext)))]
      .filter((lang): lang is string => lang !== undefined)
      .sort();
    return {
      resolved: false,
      reason: `Prop 310 § Design 6: target.language '${language}' is not registered — the resolution authority is the Map-backed extensionToLanguage registry (built-ins + pack contributions), never a spec-frozen enum. Registered languages: ${known.join(', ') || '(none)'}. Install the pack that provides this language, or correct the record.`,
    };
  }
  return { resolved: true, language, extension };
}

/**
 * The glob list handed to `validateAstGrepPattern` so it resolves to EXACTLY the
 * declared language.
 *
 * The shipped validator's language input is a glob list (`resolveAstGrepLangs`
 * derives Langs from trailing extensions), so pinning it to one grammar means
 * handing it one glob carrying one registered extension. These globs are a
 * VALIDATOR PROBE and nothing else — they are never the record's globs, never
 * reach the compiled rule, and never touch `sanitizeFileGlobs`.
 *
 * The coupling to `resolveAstGrepLangs`' derivation is pinned by a conformance
 * test (`record-lower.test.ts`: the probe resolves to exactly one Lang, and that
 * Lang equals `extensionToLang(extension)`), so a change to the shipped
 * derivation fails loud here instead of silently un-pinning the record path.
 */
export function languageProbeGlobs(extension: string): string[] {
  return [`**/*${extension}`];
}

// ── The tree-form gate (operator ruling 2026-08-21) ──────────────────────────

/**
 * NapiConfig siblings of `rule` that V1 cannot express. Named explicitly so the
 * author is told the truth — a typed construct-gap awaiting a version bump with
 * its own sibling home under `target:` — instead of napi's generic
 * "unknown field" error, which would read as a typo in the rule tree.
 */
export const V1_INEXPRESSIBLE_NAPI_KEYS = ['constraints', 'utils'] as const;

// ── Total lowering, mechanically (§ Design 12) ───────────────────────────────
//
// The obligation is "every construct the parser admits either lands on the
// compiled record or fails compile loud". Enforcing that by inspection is how a
// construct gets silently dropped three schema edits from now, so it is enforced
// twice over:
//
//   1. COMPILE TIME — the tables below are `Record<keyof T, ...>` over the parsed
//      types, so adding a grammar key without giving it a disposition is a
//      TypeScript error in this file.
//   2. RUN TIME — `assertTotalLowering` checks the actual parsed object's keys
//      against the tables and THROWS on any key without a disposition, so a
//      schema/table desync introduced through a cast still fails loud.
//
// A disposition of `'compiled'` means the construct reaches the `CompiledRule`;
// `'consumed-at-parse'` means the construct's whole effect is spent inside the
// parser and nothing downstream can observe its loss. Exactly one key qualifies
// for the latter — `schemaVersion`, which answers "whose grammar rules apply"
// and is the gate that admitted the document in the first place.

type LoweringDisposition = 'compiled' | 'consumed-at-parse';

const RECORD_KEY_LOWERING: Record<keyof RuleRecord, LoweringDisposition> = {
  schemaVersion: 'consumed-at-parse',
  severity: 'compiled',
  message: 'compiled',
  recoveryHint: 'compiled',
  target: 'compiled',
  examples: 'compiled',
  requires: 'compiled',
  curation: 'compiled',
  verification_shadow: 'compiled',
};

const TARGET_KEY_LOWERING: Record<keyof RuleTarget, LoweringDisposition> = {
  // `type` lowers to `engine` — and is re-derived INDEPENDENTLY from the payload's
  // compilation path for the § Design 3 engine-binding assert.
  type: 'compiled',
  language: 'compiled',
  pattern: 'compiled',
  rule: 'compiled',
  scope: 'compiled',
};

const SCOPE_KEY_LOWERING: Record<keyof RuleScope, LoweringDisposition> = {
  fileGlobs: 'compiled',
  excludeGlobs: 'compiled',
};

function assertKeysDispositioned(
  value: object,
  table: Record<string, LoweringDisposition>,
  at: string,
): void {
  for (const key of Object.keys(value)) {
    if (table[key] === undefined) {
      throw new Error(
        `[Totem Error] compileRuleRecord: record key '${at}${key}' has no defined lowering — Prop 310 § Design 12 forbids accepting a construct at parse and dropping it at compile. Give it a compiled home (and a disposition in record-lower.ts) or reject it at parse.`,
      );
    }
  }
}

/** § Design 12 — the runtime half of the total-lowering proof (see above). */
function assertTotalLowering(record: RuleRecord): void {
  assertKeysDispositioned(record, RECORD_KEY_LOWERING, '');
  assertKeysDispositioned(record.target, TARGET_KEY_LOWERING, 'target.');
  assertKeysDispositioned(record.target.scope, SCOPE_KEY_LOWERING, 'target.scope.');
}

// ── The compiled engine, re-derived from the payload ─────────────────────────

/**
 * Derive the engine from the fields `engineFields` actually produced. This is
 * the INDEPENDENT second side of the § Design 3 engine-binding assert: one side
 * is the record's `target.type` (via `derivedEngine`), the other is the payload's
 * actual compilation path. § Design 3 is explicit that the derivation must not
 * make the shipped assert tautological, and it does not — a payload routed
 * through the wrong `engineFields` branch diverges here and fails loud.
 */
function engineFromCompiledFields(fields: {
  pattern: string;
  astGrepPattern?: string;
  astGrepYamlRule?: unknown;
}): 'regex' | 'ast-grep' | 'unknown' {
  const hasAstGrep =
    (typeof fields.astGrepPattern === 'string' && fields.astGrepPattern.length > 0) ||
    fields.astGrepYamlRule !== undefined;
  if (hasAstGrep) return 'ast-grep';
  if (fields.pattern.length > 0) return 'regex';
  return 'unknown';
}

/**
 * A stable, deterministic diagnostic label for a record-compiled rule.
 *
 * `CompiledRule.lessonHeading` is a required diagnostic field on a schema built
 * for lesson-compiled rules; the record grammar has no heading construct and
 * § Design 4's key space is closed against inventing one. Deriving the label
 * from the identity mirrors the shipped authored-path idiom
 * (`compile.ts: candidateHeading`) and deliberately does NOT copy `message` —
 * two homes for the author's one sentence is Tenet 20's prohibited mirror, and
 * a heading that drifts from the message would be worse than a generic one.
 */
function recordHeading(ruleId: string): string {
  return `Prop 310 rule record (${ruleId})`;
}

/** Inputs the lowering needs that the record deliberately does not carry (§ Design 1/§ Design 3). */
export interface CompileRuleRecordOptions {
  /**
   * The ADR-112 §8 producer-minted rule id, supplied at the intake seam. NEVER
   * minted here and never author-set — identity is producer-owned (R17).
   */
  ruleId: string;
  /** Injected timestamp — no `new Date()` in core (Tenet 15 determinism). */
  now: string;
}

/**
 * Lower a parsed Prop 310 record into a `CompiledRule`.
 *
 * PURE (no IO). Returns a `CompileOutcome`:
 *   - `{kind: 'compiled'}` — the record lowered totally.
 *   - `{kind: 'rejected', reason}` — an authored-content gate failed (bad regex
 *     in the target or in `requires`, an unresolvable `language`, a malformed
 *     ast-grep tree, a V1-inexpressible NapiConfig key). Loud and counted, never
 *     silent; the reason names the governing § so the author is sent to the spec.
 *
 * THROWS on a producer-contract violation — a missing/malformed `ruleId`, a key
 * with no defined lowering, or an engine-binding divergence. These are bugs in
 * the code that CALLED this function, not defects in the author's record, and
 * they carry the incumbent's fail-loud idiom (`compile.ts: compileCandidate`)
 * verbatim: assert up front, before any validation work, so a violation can
 * never be masked by a coincidental `rejected` outcome.
 */
export function compileRuleRecord(
  parsed: ParsedRuleRecord,
  opts: CompileRuleRecordOptions,
): CompileOutcome {
  // ── Identity precondition, asserted UP FRONT (ADR-112 §8/§9) ──
  if (!AUTHORED_RULE_ID_RE.test(opts.ruleId)) {
    throw new Error(
      `[Totem Error] compileRuleRecord: malformed ruleId '${opts.ruleId}' — identity is minted by the ADR-112 §8 producer at the intake seam and threaded in (16 hex + optional -<n> suffix, ADR-112 §3/§8). The record grammar makes 'ruleId' INEXPRESSIBLE in-record (Prop 310 § Design 3/R17), so a malformed value here is a producer/threading bug; enthroning it would orphan the rule's controls.positive[].targetRuleId.`,
    );
  }

  const record = parsed.record;

  // ── § Design 12 — no construct is accepted at parse and dropped at compile ──
  assertTotalLowering(record);

  const target = record.target;

  // ── Engine gates (§ Design 12: fail loud, never accept-then-drop) ──
  //
  // `requires.pattern` is gated on EVERY engine, not just regex: § Design 8 makes
  // it "a safe-regex2-gated regex evaluated textually … independent of
  // `target.type`", so an ast-grep rule's requirement is subject to the same
  // ReDoS gate as a regex rule's target. Gated BEFORE the target payload so the
  // author gets the first defect in a fixed, deterministic order.
  if (record.requires !== undefined) {
    const v = validateRegex(record.requires.pattern);
    if (!v.valid) {
      return {
        kind: 'rejected',
        reason: `Prop 310 § Design 8: requires.pattern is not a usable regex (${v.reason ?? 'invalid regex pattern'}) — the requirement is a safe-regex2-gated regex evaluated textually at the declared scope, independent of target.type.`,
      };
    }
  }

  let payloadFields: {
    pattern: string;
    astGrepPattern?: string;
    astGrepYamlRule?: unknown;
  };
  let resolvedLanguage: string | undefined;

  if (target.type === 'regex') {
    // The record grammar guarantees `pattern` present and `rule`/`language` absent
    // for `type: regex`; the non-null assertion is the schema's contract, not an
    // assumption (`RuleTargetSchema.superRefine`).
    const pattern = target.pattern!;
    const v = validateRegex(pattern);
    if (!v.valid) {
      return {
        kind: 'rejected',
        reason: `Prop 310 § Design 6: target.pattern is not a usable regex (${v.reason ?? 'invalid regex pattern'}).`,
      };
    }
    payloadFields = engineFields('regex', pattern);
  } else {
    // ── ast-grep: resolve the language FIRST, then validate under exactly it ──
    const resolution = resolveRecordLanguage(target.language!);
    if (!resolution.resolved) return { kind: 'rejected', reason: resolution.reason };
    resolvedLanguage = resolution.language;
    const probeGlobs = languageProbeGlobs(resolution.extension);

    if (target.rule !== undefined) {
      const inexpressible = V1_INEXPRESSIBLE_NAPI_KEYS.find((key) => key in target.rule!);
      if (inexpressible !== undefined) {
        return {
          kind: 'rejected',
          reason: `Prop 310 § Design 4 (operator ruling 2026-08-21, tree-form): 'target.rule' is the ast-grep RULE TREE, and '${inexpressible}' is a NapiConfig SIBLING of the rule — inexpressible at V1 (zero of the 19 compound corpus rules use it). Demand is typed as a construct-gap at the § Design 15 trial and lands by grammar version bump with its own home under 'target:', never smuggled inside the tree.`,
        };
      }
      // The tree-form ruling's derivation: the record carries the TREE, the
      // lowering builds the wrapper. `language` is derived from the resolved
      // `target.language`, so the record never carries a duplicate language home.
      const napiConfig = {
        rule: target.rule,
        language: extensionToLang(resolution.extension),
      };
      const v = validateAstGrepPattern(napiConfig, probeGlobs);
      if (!v.valid) {
        return {
          kind: 'rejected',
          reason: `Prop 310 § Design 6: target.rule failed ast-grep validation under the declared language '${resolvedLanguage}' (${v.reason ?? 'invalid ast-grep rule'}). V1 validates under exactly the declared grammar — the shipped try-each-glob-derived-Lang cross-grammar acceptance does not apply on the record path.`,
        };
      }
      payloadFields = engineFields('ast-grep', napiConfig);
    } else {
      const pattern = target.pattern!;
      const v = validateAstGrepPattern(pattern, probeGlobs);
      if (!v.valid) {
        return {
          kind: 'rejected',
          reason: `Prop 310 § Design 6: target.pattern failed ast-grep validation under the declared language '${resolvedLanguage}' (${v.reason ?? 'invalid ast-grep pattern'}). V1 validates under exactly the declared grammar — the shipped try-each-glob-derived-Lang cross-grammar acceptance does not apply on the record path.`,
        };
      }
      payloadFields = engineFields('ast-grep', pattern);
    }
  }

  // ── § Design 3 engine binding, asserted on two INDEPENDENTLY-derived sides ──
  const payloadEngine = engineFromCompiledFields(payloadFields);
  if (payloadEngine !== parsed.derivedEngine) {
    throw new Error(
      `[Totem Error] compileRuleRecord: record declared target.type '${parsed.derivedEngine}' but its payload compiled as '${payloadEngine}' — the two sides originate differently (the record's target.type vs the payload's actual compilation path), so this divergence is a lowering bug, not an authoring one (Prop 310 § Design 3, ADR-112 §3).`,
    );
  }

  const heading = recordHeading(opts.ruleId);
  const rule = CompiledRuleSchema.parse({
    // ADR-112 §8/§9 id-unification: the compiled identity IS the minted ruleId.
    lessonHash: opts.ruleId,
    lessonHeading: heading,
    message: record.message,
    engine: parsed.derivedEngine,
    ...payloadFields,
    // § Design 7 — VERBATIM. `sanitizeFileGlobs` never runs on this path: the
    // strict dialect already validated these at parse, and expansion/promotion
    // are the silent transforms the grammar exists to kill.
    fileGlobs: [...record.target.scope.fileGlobs],
    ...(record.target.scope.excludeGlobs !== undefined
      ? { excludeGlobs: [...record.target.scope.excludeGlobs] }
      : {}),
    severity: record.severity,
    ...(record.recoveryHint !== undefined ? { recoveryHint: record.recoveryHint } : {}),
    examples: record.examples.map((example) => ({ bad: example.bad, good: example.good })),
    ...(record.requires !== undefined
      ? { requires: { pattern: record.requires.pattern, scope: record.requires.scope } }
      : {}),
    ...(record.curation !== undefined ? { curation: { ...record.curation } } : {}),
    // § Design 9 / Amendment R4 — carried VERBATIM, never evaluated at V1. The
    // record key's named snake_case exception is renamed exactly here, once.
    ...(record.verification_shadow !== undefined
      ? { verificationShadow: { ...record.verification_shadow } }
      : {}),
    ...(resolvedLanguage !== undefined ? { language: resolvedLanguage } : {}),
    compiledAt: opts.now,
    createdAt: opts.now,
    // Yellow / sensor-only, exactly as the authored path (§ Design "State-surface
    // backing": every rule minted from this grammar enters unverified, ADR-112
    // §1). `legitimacy`/`ruleClass` stay ABSENT — the sense→enforce crossing is
    // priced by the Amendment's proof-required ruling, never by this lowering.
    unverified: true,
  });

  return { kind: 'compiled', rule };
}
