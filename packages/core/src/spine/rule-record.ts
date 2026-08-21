// ─── Prop 310 V1 record grammar — the parser (slice 1 of the V1 build) ───────
//
// One rule = one YAML document = one file at `.totem/rules/<slug>.rule.yaml`
// (Prop 310 § Design 1, R10). This module is the RECORD half only: the closed-key
// grammar (§§ Design 2–9), the normative glob dialect (§ Design 7), and the pure
// `ParsedRuleRecord` value (§ Design 3 + Amendment 1 item 3). Lowering into the
// existing compile seam is slice 2; intake, the record→envelope derivation, and
// manifest attestation are slice 3.
//
// § Design 14 flips normativity: THIS SPEC IS NORMATIVE AND THE PARSER IS ITS
// IMPLEMENTATION — where the two diverge, this file is the bug. The conformance
// suite (`rule-record.test.ts`) pins one negative fixture per banned-silent
// behaviour (silent default / silent skip / silent expansion / silent promotion)
// plus one per dialect rule.
//
// Explicit-or-error throughout (§ Design 4): NO field has a default anywhere in
// the grammar, and an unknown `schemaVersion` / `target.type` / reserved
// construct hits the § Design 2 no-silent-skip gate — V1 declares no degraded
// mode, so it fails loud rather than dropping a rule.
//
// Identity is producer-owned (§ Design 3 / R17): no author-set `id`, `ruleId`, or
// per-rule `version:`, and `declaredEngine` is DERIVED from `target.type` here,
// never author-mirrored. The derivation does not make the shipped engine-binding
// assert tautological — its other side is the payload's actual compilation path
// (slice 2), so a yaml-fence-under-`regex` divergence still fails loud there.
//
// Determinism (§ Design 3): no module-level mutable state, no clock, no
// randomness — the same bytes always yield a deep-equal `ParsedRuleRecord`.

import { createHash } from 'node:crypto';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { canonicalStringify } from '../compile-manifest.js';
import { TotemParseError } from '../errors.js';
import type { DeclaredEngine } from './authored-rule.js';

// ── Error classes ────────────────────────────────────────────────────────────
//
// Every record-grammar failure is a hard error naming the FILE and the RECORD
// KEY PATH (§ Failure modes: "hard error, file+path named"). The two subclasses
// exist so the § Design 2 no-silent-skip gate and the § Design 4 inexpressible-key
// rejection are MECHANICALLY distinguishable from a generic schema failure —
// "distinct diagnostic" is a testable property, not a wording preference.

/** Base: any Prop 310 record-grammar parse failure. Carries file + key path. */
export class RuleRecordParseError extends TotemParseError {
  readonly filePath: string;
  readonly keyPath: string;

  constructor(
    filePath: string,
    keyPath: string,
    detail: string,
    recoveryHint: string,
    cause?: unknown,
  ) {
    super(`${filePath}: ${keyPath} — ${detail}`, recoveryHint, cause);
    this.name = 'RuleRecordParseError';
    this.filePath = filePath;
    this.keyPath = keyPath;
  }
}

/** The § Design 2 no-silent-skip constructs a V1 consumer may never drop silently. */
export type NoSilentSkipConstruct = 'schemaVersion' | 'target.type' | 'requires.scope';

/**
 * § Design 2 (R5) — unknown `schemaVersion`, unknown `target.type`, or a
 * reserved-unimplemented construct (`requires.scope: block`, § Design 8). A V1
 * consumer that cannot declare a degraded mode enumerating every skipped rule
 * MUST fail; Prop 270 §6.3's warn-and-ignore is superseded (a silent
 * warn-and-ignore is a fail-open rule drop in a governance compiler).
 */
export class RuleRecordNoSilentSkipError extends RuleRecordParseError {
  readonly construct: NoSilentSkipConstruct;

  constructor(filePath: string, construct: NoSilentSkipConstruct, detail: string) {
    super(
      filePath,
      construct,
      detail,
      'V1 declares no degraded mode — bump the grammar version or fix the record; a consumer may never skip the rule silently (Prop 310 § Design 2).',
    );
    this.name = 'RuleRecordNoSilentSkipError';
    this.construct = construct;
  }
}

/**
 * § Design 4 — a producer-owned / intake-seam key is INEXPRESSIBLE in a record at
 * any depth. Distinct from a generic unknown-key rejection: the author needs to
 * be told the key belongs to the ADR-112 producer or the intake invocation
 * (§ Design 1), not that they typo'd a grammar field.
 */
export class RuleRecordProducerKeyError extends RuleRecordParseError {
  readonly producerKey: string;

  constructor(filePath: string, keyPath: string, producerKey: string) {
    super(
      filePath,
      keyPath,
      `'${producerKey}' is producer-owned / intake-seam metadata and is INEXPRESSIBLE in a rule record (Prop 310 § Design 1/§ Design 3/§ Design 4)`,
      producerKeyRecoveryHint(keyPath, producerKey),
    );
    this.name = 'RuleRecordProducerKeyError';
    this.producerKey = producerKey;
  }
}

const PRODUCER_KEY_BASE_HINT =
  'Remove the key. Identity is minted by the ADR-112 producer; authoring metadata and attestations are supplied at the `totem rule author` intake seam, never in-record.';

// The one key a COMPLETE ast-grep config file carries at its own top level that
// is ALSO inexpressible here: a pasted whole config is the likely authoring
// mistake behind a hit at this depth, and the generic "producer-owned" hint would
// leave the author with nowhere to put the value. `language` is deliberately NOT
// part of this test — the hint fires only from `RuleRecordProducerKeyError`,
// which is thrown only for `RULE_RECORD_INEXPRESSIBLE_KEYS` members, and
// `language` is not one (it is a LEGAL record key, at `target.language`). The
// hint's advice still names it, because a pasted config carries both halves and
// the author needs to know where each one goes.
const PASTED_AST_GREP_CONFIG_KEY = 'id';

function producerKeyRecoveryHint(keyPath: string, producerKey: string): string {
  if (keyPath.startsWith('target.rule.') && producerKey === PASTED_AST_GREP_CONFIG_KEY) {
    return `${PRODUCER_KEY_BASE_HINT} This looks like a PASTED complete ast-grep config: such a file carries \`id\`/\`language\` at its own top level, but \`target.rule\` carries ONLY the rule payload — \`id\` is producer-minted (§ Design 3) and the language belongs at \`target.language\` (§ Design 4/§ Design 6).`;
  }
  return PRODUCER_KEY_BASE_HINT;
}

// ── § Design 4 — the inexpressible key set ───────────────────────────────────
//
// The census-constraint-5 producer-owned set, plus `provenance` (the ADR-112
// producer's own OUTPUT field — a semantic collision no shipped gate catches,
// which is why the grammar must close it), plus `id` / `version` /
// `declaredEngine` (§ Design 3 / R17), plus ADR-112's intake-seam authoring
// metadata (§ Design 1). Scanned at EVERY depth: `.strict()` alone is not
// recursive across an opaque payload, and § Design 4 says "inexpressible at any
// depth" — the same discipline the shipped intake reject list applies.

/** § Design 4 — keys a record may never carry, at any depth. */
export const RULE_RECORD_INEXPRESSIBLE_KEYS: ReadonlySet<string> = new Set([
  // census constraint 5 — the ADR-112 producer's own verdict/identity/routing fields
  'structuralEligibility',
  'decidable',
  'judgedBy',
  'basis',
  'ruleId',
  'authoringLedgerRef',
  'classifierDisposition',
  'disposition',
  'routing',
  'unverified',
  // the producer's discriminated-union output field (§ Design 4's named addition)
  'provenance',
  // § Design 3 / R17 — identity is never authored; the engine is never mirrored
  'id',
  'version',
  'declaredEngine',
  // § Design 1 — ADR-112 per-rule authoring metadata lives at the intake seam
  'author',
  'authoredAt',
  'targetDefect',
  'structuralClass',
  'positiveFixtures',
  'negativeFixtures',
  'origin',
]);

// ONE path grammar across every diagnostic: dot-form at every depth, array
// ordinals included (`examples.0.bad`), matching how Zod renders `issue.path`.
// Two renderings of the same address would make a diagnostic ungreppable.
function joinKeyPath(at: string, segment: string | number): string {
  return at === '' ? String(segment) : `${at}.${segment}`;
}

/**
 * § Design 4 — reject the inexpressible key set at EVERY depth, and refuse a
 * cyclic document while doing it.
 *
 * `ancestors` is the DFS ancestor stack, not a visit log: YAML resolves a
 * RECURSIVE anchor (`target: &t` … `rule: {loop: *t}`) into a genuinely cyclic
 * object, which un-guarded recursion turns into a raw `RangeError` — a crash, not
 * the `RuleRecordParseError` this module's totality contract promises. Tracking
 * ANCESTORS (added on entry, removed on exit) detects a true cycle while leaving a
 * legal SHARED anchor — the same node aliased twice as siblings, a DAG, not a
 * cycle — free to validate; a visit-once log would misdiagnose that as a cycle.
 */
function assertNoInexpressibleKeys(
  filePath: string,
  value: unknown,
  at: string,
  ancestors: WeakSet<object>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (ancestors.has(value)) {
    throw new RuleRecordParseError(
      filePath,
      at === '' ? '(document)' : at,
      'cyclic YAML anchor — a record is a finite tree; a recursive alias can never be lowered totally or hashed (Prop 310 § Design 1/§ Design 12)',
      'Remove the recursive `&anchor` / `*alias` reference and write the payload out explicitly.',
    );
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, i) =>
      assertNoInexpressibleKeys(filePath, entry, joinKeyPath(at, i), ancestors),
    );
  } else {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const keyPath = joinKeyPath(at, key);
      if (RULE_RECORD_INEXPRESSIBLE_KEYS.has(key)) {
        throw new RuleRecordProducerKeyError(filePath, keyPath, key);
      }
      assertNoInexpressibleKeys(filePath, child, keyPath, ancestors);
    }
  }
  ancestors.delete(value);
}

// ── § Design 7 — the normative glob dialect ──────────────────────────────────
//
// From V1 the dialect is SPEC, not sanitizer behaviour: it binds the record path
// only, while `sanitizeFileGlobs`' tolerant behaviour for the frozen legacy
// lesson corpus is untouched (§ Design 7 conformance scope). A glob is retained
// BYTE-VERBATIM — no expansion, no promotion, no normalization of any kind: a
// glob means what it says, so `*.ts` is root-level and tree-wide is written
// `**/*.ts` (§ Design 7 "No silent promotion").

/**
 * The closed set of § Design 7 rules a glob can violate. A runtime value, not a
 * bare type union, so the conformance suite can assert every rule has a negative
 * fixture — an unexercised rule is an unpinned rule (§ Design 14).
 */
export const GLOB_DIALECT_RULES = [
  'empty',
  'surrounding-whitespace',
  'separator',
  'absolute-path',
  'drive-letter',
  'brace-expansion',
  'negation',
  'regex-syntax',
  'empty-segment',
  'current-segment',
  'parent-segment',
  'embedded-globstar',
  'adjacent-globstar',
] as const;

/** The § Design 7 rule a glob violated. Each maps to one negative conformance fixture. */
export type GlobDialectRule = (typeof GLOB_DIALECT_RULES)[number];

/** A dialect violation: the rule broken + a message citing it. */
export interface GlobDialectViolation {
  rule: GlobDialectRule;
  message: string;
}

// `.` is DELIBERATELY absent — extension forms (`*.ts`) are the dialect's own
// allowed shape. `|`, `^`, and `$` are regex constructs a glob never means, and
// admitting them would let a regex-shaped glob silently match nothing.
const REGEX_SYNTAX_CHARS = ['[', ']', '(', ')', '?', '+', '|', '^', '$'] as const;
const DRIVE_LETTER_RE = /^[A-Za-z]:/;
// The relative-navigation segments a git-tracked, repo-relative path NAME never
// contains (§ Design 7). WHOLE segments only: a dot inside a segment is an
// ordinary literal (`.github`, `a..b`, and every `*.ts` extension form).
const CURRENT_SEGMENT = '.';
const PARENT_SEGMENT = '..';

/**
 * § Design 7 — validate one glob against the normative dialect. Returns the first
 * violation (checks run in a fixed order, so the diagnostic is deterministic) or
 * `null` when the glob is dialect-clean. Pure: it never rewrites the glob.
 *
 * Allowed: literal segments; `*` as a single-segment wildcard (including
 * extension forms like `*.ts`); `**` as a whole-segment globstar, non-adjacent
 * and non-nested. Anything outside that closed set is a parse error — an empty
 * segment is not a literal segment, so it is rejected too.
 */
export function checkGlobDialect(glob: string): GlobDialectViolation | null {
  if (glob.trim().length === 0) {
    return {
      rule: 'empty',
      message:
        'empty glob — the dialect admits literal segments, `*`, and `**` only (Prop 310 § Design 7)',
    };
  }
  if (glob !== glob.trim()) {
    return {
      rule: 'surrounding-whitespace',
      message:
        'leading/trailing whitespace — matching is against git-tracked path NAMES, which never carry it, so the glob can only ever match nothing (Prop 310 § Design 7); a glob is retained byte-verbatim, so the parser will not trim it for you',
    };
  }
  if (glob.includes('\\')) {
    return {
      rule: 'separator',
      message:
        'backslash in a glob — records use `/` exclusively; matchers normalize host separators at evaluation (Prop 310 § Design 7 Windows semantics)',
    };
  }
  if (glob.startsWith('/')) {
    return {
      rule: 'absolute-path',
      message: 'absolute path — globs are repo-relative (Prop 310 § Design 7 Windows semantics)',
    };
  }
  if (DRIVE_LETTER_RE.test(glob)) {
    return {
      rule: 'drive-letter',
      message: 'drive letter — globs are repo-relative (Prop 310 § Design 7 Windows semantics)',
    };
  }
  if (glob.includes('{') || glob.includes('}')) {
    return {
      rule: 'brace-expansion',
      message:
        'brace expansion — braces are OUT of the normative dialect; expansion is a silent transform of authored intent, so write each glob explicitly (Prop 310 § Design 7 brace ruling)',
    };
  }
  if (glob.includes('!')) {
    return {
      rule: 'negation',
      message:
        '`!`-negation — exclusion is structural: put a POSITIVE-form glob in `excludeGlobs` (Prop 310 § Design 7)',
    };
  }
  const regexChar = REGEX_SYNTAX_CHARS.find((c) => glob.includes(c));
  if (regexChar !== undefined) {
    return {
      rule: 'regex-syntax',
      message: `regex syntax '${regexChar}' in a glob — regex constructs are banned in the dialect (Prop 310 § Design 7)`,
    };
  }
  const segments = glob.split('/');
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (segment.length === 0) {
      return {
        rule: 'empty-segment',
        message:
          'empty path segment — an empty segment is not a literal segment (Prop 310 § Design 7)',
      };
    }
    if (segment === CURRENT_SEGMENT) {
      return {
        rule: 'current-segment',
        message:
          '`.` segment — globs are repo-relative and match against git-tracked path names, which never contain a `.` segment, so the glob can only ever match nothing; drop the `./` (Prop 310 § Design 7 Windows semantics)',
      };
    }
    if (segment === PARENT_SEGMENT) {
      return {
        rule: 'parent-segment',
        message:
          '`..` segment — globs are repo-relative and match against git-tracked path names, which never contain `..`, so the glob can only ever match nothing (Prop 310 § Design 7 Windows semantics)',
      };
    }
    if (segment.includes('**') && segment !== '**') {
      return {
        rule: 'embedded-globstar',
        message: `globstar embedded in segment '${segment}' — \`**\` is whole-segment only, never nested inside a segment (Prop 310 § Design 7)`,
      };
    }
    if (segment === '**' && i > 0 && segments[i - 1] === '**') {
      return {
        rule: 'adjacent-globstar',
        message: 'adjacent globstars — `**` segments may not be adjacent (Prop 310 § Design 7)',
      };
    }
  }
  return null;
}

// ── The record schema (§§ Design 2–9) ────────────────────────────────────────

/** § Design 2 — the only `schemaVersion` this V1 grammar admits. */
export const RULE_RECORD_SCHEMA_VERSION = 1;

// Non-mutating emptiness check, matching the shipped spine discipline: a record
// value is never trimmed on the way in (an exemplar is certification preimage
// material — § Design 10 — so a transform would move the hash basis).
//
// `label` is the ORDINAL-FREE dot-form address, never bracket-form: the one path
// grammar above governs rendered MESSAGES too, not just `keyPath`, and the
// concrete ordinal is already carried by the Zod issue path the renderer prefixes
// (`examples.0.bad: examples.bad must be non-empty`).
const nonEmpty = (label: string) =>
  z.string().refine((s) => s.trim().length > 0, { message: `${label} must be non-empty` });

/** § Design 4 — closed severity vocabulary; NO default (the census's silent warning-default is killed). */
export const RuleSeveritySchema = z.enum(['error', 'warning']);
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>;

/**
 * § Design 6 (R16) — the V1 authoring enum. `ast` is dropped from the AUTHORING
 * surface (0 of 485 corpus rules) while reader/compiled enums keep it inert;
 * `rego` and ADR-109's action-rule type join by grammar version bump.
 */
export const RuleTargetTypeSchema = z.enum(['ast-grep', 'regex']);
export type RuleTargetType = z.infer<typeof RuleTargetTypeSchema>;

/**
 * § Design 6 (R16) — the S-expression tier. Reader/compiled enums keep it as an
 * inert legacy member with a deprecation diagnostic; the AUTHORING surface drops
 * it, and unlike `rego` / ADR-109's action-rule type it does NOT return by version
 * bump. Exported with its diagnostic so the conformance suite pins the wording:
 * pointing an author at a bump that will never carry `ast` is a wrong answer, not
 * a terse one.
 */
export const LEGACY_INERT_ENGINE = 'ast';
export const LEGACY_ENGINE_DETAIL =
  '`ast` (the S-expression tier) is DROPPED from the V1 authoring surface and does NOT return by version bump — 0 of the 485 corpus rules used it. Reader and compiled enums keep `ast` as an inert legacy member with a deprecation diagnostic, but no record may declare it (§ Design 6, R16)';

// § Design 3/§ Design 6 (R16) — the authoring enum is a strict subset of the
// reader-side `DeclaredEngineSchema`, so a target-enum widening can never outrun
// the enum the compiled artifact is read under. The conditional type collapses to
// `never` the moment the subset breaks, and the ASSIGNMENT below is what makes
// that a COMPILE ERROR — a bare unused conditional type is inert, so the guard has
// to be consumed to guard anything. The runtime half is pinned in the conformance
// suite (`DeclaredEngineSchema.options` ⊇ `RuleTargetTypeSchema.options`).
type _RuleTargetTypeIsDeclaredEngine = RuleTargetType extends DeclaredEngine ? true : never;
const _ruleTargetTypeSubsetCheck: _RuleTargetTypeIsDeclaredEngine = true;

/**
 * § Design 8 — the absence unit. The closed name space RESERVES `line | block |
 * file`; `line` and `file` are implemented at V1 and `block` is
 * reserved-unimplemented pending a language adapter's boundary definition, so it
 * hits the § Design 2 gate rather than parsing. NO default — omitting `scope:`
 * is a parse error (a file-as-default is a silent default reborn).
 */
export const RequiresScopeSchema = z.enum(['line', 'file']);
export type RequiresScope = z.infer<typeof RequiresScopeSchema>;

/** § Design 8 — the reserved-unimplemented member of the `requires.scope` name space. */
export const REQUIRES_SCOPE_RESERVED = 'block';

// § Design 7 — every glob entry is dialect-validated at parse; the value itself is
// carried through byte-verbatim.
const GlobSchema = z.string().superRefine((value, ctx) => {
  const violation = checkGlobDialect(value);
  if (violation !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: violation.message });
  }
});

/** § Design 4 — `target.scope`: positive globs only, with first-class structural exclusions. */
export const RuleScopeSchema = z
  .object({
    fileGlobs: z
      .array(GlobSchema)
      .min(1, { message: 'target.scope.fileGlobs must declare ≥1 glob (Prop 310 § Design 5)' }),
    /**
     * Applied as `positiveMatch && !excludeMatch` — positive-form entries, never
     * `!`-negation. Min-1 WHEN PRESENT: an empty list is a silent no-op, and
     * "no exclusions" is expressed by OMITTING the key (§ Design 4 — no key in
     * this grammar carries a do-nothing value).
     */
    excludeGlobs: z
      .array(GlobSchema)
      .min(1, {
        message:
          'target.scope.excludeGlobs must declare ≥1 glob when present — omit the key to declare no exclusions (Prop 310 § Design 4)',
      })
      .optional(),
  })
  .strict();
export type RuleScope = z.infer<typeof RuleScopeSchema>;

/**
 * IR-2 — the ast-grep compound payload INTERIOR is opaque at parse. § Design 4
 * calls it a "NapiConfig subset"; structural NapiConfig validation is the
 * COMPILE-stage engine gate (§ Failure modes: "Payload fails engine gate
 * (safe-regex2, NapiConfig validation) … hard error at intake preflight"), which
 * is slice 2. The record grammar closes its OWN key space, not the engine's — so
 * the interior is carried verbatim and only its shape (a non-empty mapping) is
 * checked here. The § Design 4 inexpressible-key scan still descends into it.
 */
const AstGrepRulePayloadSchema = z.record(z.unknown()).refine((v) => Object.keys(v).length > 0, {
  message: 'target.rule must be a non-empty compound payload',
});

/**
 * § Design 4 — `target`. `language` is REQUIRED for ast-grep and FORBIDDEN for
 * regex (§ Design 6: one declared language, validated under exactly that grammar
 * — replacing the try-each-glob-derived-Lang cross-grammar acceptance). The
 * payload is exactly one of `pattern` (flat) or `rule` (compound) for ast-grep,
 * and `pattern` only for regex.
 */
export const RuleTargetSchema = z
  .object({
    type: RuleTargetTypeSchema,
    /** § Design 6 — an identifier TOKEN at parse; it resolves against the Map-backed registry at compile (slice 2), never a spec-frozen enum. */
    language: nonEmpty('target.language').optional(),
    pattern: nonEmpty('target.pattern').optional(),
    rule: AstGrepRulePayloadSchema.optional(),
    scope: RuleScopeSchema,
  })
  .strict()
  .superRefine((target, ctx) => {
    const custom = z.ZodIssueCode.custom;
    if (target.type === 'ast-grep' && target.language === undefined) {
      ctx.addIssue({
        code: custom,
        path: ['language'],
        message:
          'target.language is REQUIRED for `type: ast-grep` — undefined-for-type is an error, never a default (Prop 310 § Design 4/§ Design 6)',
      });
    }
    if (target.type === 'regex' && target.language !== undefined) {
      ctx.addIssue({
        code: custom,
        path: ['language'],
        message:
          'target.language is FORBIDDEN for `type: regex` — a regex payload has no grammar binding (Prop 310 § Design 4)',
      });
    }
    const hasPattern = target.pattern !== undefined;
    const hasRule = target.rule !== undefined;
    if (target.type === 'regex' && hasRule) {
      ctx.addIssue({
        code: custom,
        path: ['rule'],
        message:
          'target.rule is FORBIDDEN for `type: regex` — the compound payload belongs to ast-grep (Prop 310 § Design 4)',
      });
    }
    if (target.type === 'regex' && !hasPattern) {
      ctx.addIssue({
        code: custom,
        path: ['pattern'],
        message:
          'target.pattern is REQUIRED for `type: regex` (Prop 310 § Design 4/§ Design 5 mandatory set)',
      });
    }
    if (target.type === 'ast-grep' && hasPattern && hasRule) {
      ctx.addIssue({
        code: custom,
        path: ['rule'],
        message:
          'target carries BOTH `pattern` and `rule` — an ast-grep payload is exactly one of them (Prop 310 § Design 4)',
      });
    }
    if (target.type === 'ast-grep' && !hasPattern && !hasRule) {
      ctx.addIssue({
        code: custom,
        path: ['pattern'],
        message:
          'target carries NEITHER `pattern` nor `rule` — an ast-grep payload is exactly one of them (Prop 310 § Design 4/§ Design 5 mandatory set)',
      });
    }
  });
export type RuleTarget = z.infer<typeof RuleTargetSchema>;

/**
 * § Design 5/§ Design 10 — one bad/good exemplar pair. IR-1: both sides are
 * non-empty. `examples` is certification's PRIMARY PREIMAGE SOURCE (ADR-112 §4)
 * and Amendment 1 makes the record the EDITABLE home, so a zero-byte exemplar
 * cannot serve as the fire-on-bad ∧ silent-on-good differential it exists to be.
 *
 * Named `RuleRecordExample`, not `RuleExample`: the shipped LEGACY
 * `RuleExamples` (`lesson-pattern.ts`, on the same barrel) is the hit/miss shape
 * of the frozen lesson path this grammar supersedes, and two barrel exports one
 * character apart is a mis-import waiting to happen.
 */
export const RuleRecordExampleSchema = z
  .object({
    bad: nonEmpty('examples.bad'),
    good: nonEmpty('examples.good'),
  })
  .strict();
export type RuleRecordExample = z.infer<typeof RuleRecordExampleSchema>;

/**
 * § Design 8 — the absence / must-contain block. Fires on a `target` match at
 * locus L iff `requires.pattern` does NOT match within the declared scope
 * containing L. V1 carries EXACTLY ONE block (multi-requires is a version-bump
 * extension), so this is a single mapping, never a list.
 */
export const RuleRequiresSchema = z
  .object({
    /** A safe-regex2-gated regex evaluated TEXTUALLY at the declared scope (gate is slice 2), independent of `target.type`. */
    pattern: nonEmpty('requires.pattern'),
    scope: RequiresScopeSchema,
  })
  .strict();
export type RuleRequires = z.infer<typeof RuleRequiresSchema>;

/**
 * § Design 4 (R8) — Prop 270 §8's curation-provenance block, carried under the
 * name `curation:` (renamed there because `provenance` is the ADR-112 producer's
 * own output field). Keys are camelCase, normalized from Prop 270 §8's snake_case
 * — a casing normalization, not a semantic change. The block is optional for
 * direct-authored rules and REQUIRED for Baseline-5-curated ones.
 *
 * SHAPE, per OPERATOR RULING 2026-08-21 (superseding IR-4's build-time
 * complete-or-absent reading, which rejected a lone `sourceLesson`):
 *
 *   - `sourceLesson` is REQUIRED whenever the block is present. It is § Design 1's
 *     record→lesson link — the one thing every curated rule has, since a curated
 *     rule always derives from a lesson — so a block without it is incoherent.
 *   - `curatedBy` / `curatedAt` / `baseline5Phase` are the Baseline-5 PROCESS
 *     trio (Prop 270 §8), optional as a GROUP but ALL-OR-NONE together: a
 *     direct-authored rule carries the link alone, a Baseline-5-curated rule
 *     carries the whole process record, and a PARTIAL trio is a parse error
 *     naming the missing members.
 *
 * No defaults are introduced by the relaxation, and the key space stays closed —
 * "optional" here means absent, never silently filled in.
 */
/** Prop 270 §8's Baseline-5 process trio — optional as a group, all-or-none together. */
export const CURATION_PROCESS_FIELDS = ['curatedBy', 'curatedAt', 'baseline5Phase'] as const;

export const RuleCurationSchema = z
  .object({
    /** § Design 1 — the record→lesson link. Required whenever the block is present. */
    sourceLesson: nonEmpty('curation.sourceLesson'),
    curatedBy: nonEmpty('curation.curatedBy').optional(),
    curatedAt: nonEmpty('curation.curatedAt').optional(),
    baseline5Phase: z
      .number()
      .int({ message: 'curation.baseline5Phase must be an integer' })
      .optional(),
  })
  .strict()
  .superRefine((curation, ctx) => {
    // All-or-none, not "any subset": a half-filled process record would leave a
    // reader guessing which half is authoritative, and the grammar carries no
    // defaults to fill the gap. Every MISSING member is named, so the author is
    // told what to add rather than that something is wrong.
    const missing = CURATION_PROCESS_FIELDS.filter((field) => curation[field] === undefined);
    if (missing.length === 0 || missing.length === CURATION_PROCESS_FIELDS.length) return;
    for (const field of missing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `curation.${field} is REQUIRED once any Baseline-5 process field is present — the trio (${CURATION_PROCESS_FIELDS.join(', ')}) is all-or-none (Prop 310 § Design 4 / Prop 270 §8; operator ruling 2026-08-21)`,
      });
    }
  });
export type RuleCuration = z.infer<typeof RuleCurationSchema>;

/**
 * § Design 9 (Amendment R4) — the optional classification block. Parsed under its
 * closed keys and retained VERBATIM; never evaluated at V1. The snake_case name
 * is a deliberate, named exception to the grammar's camelCase (§ Design 4): the
 * key is already reserved in shipped forward-compat readers, so renaming it would
 * buy consistency at the price of a pointless migration. NEVER rename it.
 */
export const VerificationShadowSchema = z
  .object({
    type: nonEmpty('verification_shadow.type'),
    source: nonEmpty('verification_shadow.source'),
  })
  .strict();
export type VerificationShadow = z.infer<typeof VerificationShadowSchema>;

/**
 * Prop 310 § Design 4 — the V1 rule record. `.strict()` at every depth of the
 * record's own key space; no field anywhere has a default. The § Design 5
 * mandatory set is `schemaVersion`, `severity`, `message`, `target.type`,
 * `target.<payload>`, `target.scope.fileGlobs`, and a non-empty `examples`.
 */
export const RuleRecordSchema = z
  .object({
    schemaVersion: z.literal(RULE_RECORD_SCHEMA_VERSION),
    severity: RuleSeveritySchema,
    /** REQUIRED, non-empty (R8) — the census found `message` on 4 of 140 hand-authored lessons. */
    message: nonEmpty('message'),
    recoveryHint: nonEmpty('recoveryHint').optional(),
    target: RuleTargetSchema,
    examples: z.array(RuleRecordExampleSchema).min(1, {
      message:
        'examples must carry ≥1 bad/good pair — it is certification’s primary preimage source (Prop 310 § Design 5)',
    }),
    requires: RuleRequiresSchema.optional(),
    curation: RuleCurationSchema.optional(),
    verification_shadow: VerificationShadowSchema.optional(),
  })
  .strict();
export type RuleRecord = z.infer<typeof RuleRecordSchema>;

// ── § Design 10 / Amendment 1 item 3 — the CR-blind per-pair content hash ─────

/** One exemplar pair's drift sensor, keyed by its ordinal within the record (§ Design 10). */
export interface RuleExamplePairHash {
  /** The `examples[i]` ordinal — half of the `(ruleId, ordinal)` join key; the producer supplies `ruleId` at intake (slice 3). */
  ordinal: number;
  /** sha256 hex over the LF-image of the pair's material. */
  hash: string;
}

/**
 * Recursively LF-normalize every string in a value.
 *
 * MIRRORED, not shared: `lfDeepNormalize` is module-private in
 * `spine/authoring-ledger.ts`, and Amendment 1 item 3 names that helper as the
 * hash-material normalization this basis MIRRORS while calling it "a different
 * edge" — the authoring-ledger's material and § Design 10's exemplar pairs are
 * distinct hash bases. Keeping them separate means an edit to one basis cannot
 * silently move the other.
 */
function lfDeepNormalize(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n');
  if (Array.isArray(value)) return value.map(lfDeepNormalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, lfDeepNormalize(v)]),
    );
  }
  return value;
}

/**
 * Amendment 1 item 3 — the § Design 10 per-pair content hash is CR-BLIND,
 * computed over the LF-image of its material, so a CRLF-authored and an
 * LF-authored variant of the same exemplar hash IDENTICALLY. The trial's P3 row
 * (`serialization-admit`) is exactly the class this defeats: a writer that
 * escape-smuggles `\r` past the admit hop must not fire a false drift alarm.
 */
export function ruleExamplePairHash(example: RuleRecordExample): string {
  return createHash('sha256')
    .update(canonicalStringify(lfDeepNormalize({ bad: example.bad, good: example.good })))
    .digest('hex');
}

// ── The parser ───────────────────────────────────────────────────────────────

/**
 * The parser's output — a pure VALUE, per-invocation, never cached (§ Data model
 * deltas): the validated record, the § Design 3 derived engine, and the
 * Amendment 1 item 3 per-pair hashes.
 */
export interface ParsedRuleRecord {
  record: RuleRecord;
  /**
   * § Design 3 / R17 — derived from `target.type`, NEVER author-mirrored (a
   * mirrored engine field is Tenet 20's prohibited copy at record scale).
   */
  derivedEngine: RuleTargetType;
  /** One entry per `examples[i]`, in ordinal order (§ Design 10 drift sensors). */
  examplePairHashes: RuleExamplePairHash[];
}

const FIX_THE_RECORD =
  'Fix the record file — the V1 grammar is explicit-or-error at every key (Prop 310 § Design 4).';

/**
 * Parse one `.totem/rules/<slug>.rule.yaml` document into a validated
 * `ParsedRuleRecord`. Pure and total in the § Design 12 sense: it either returns
 * a fully-validated value or THROWS a `RuleRecordParseError` naming the file and
 * the offending record key path. There is no partial, degraded, or
 * best-effort result — V1 declares no degraded mode (§ Design 2).
 *
 * Gate order is load-bearing: the § Design 2 no-silent-skip probes and the
 * § Design 4 inexpressible-key scan run BEFORE full schema validation, so an
 * unknown version / type / reserved construct and a producer-owned key each
 * surface their OWN diagnostic instead of a misleading shape failure against a
 * V1-shaped schema.
 */
export function parseRuleRecord(content: string, filePath: string): ParsedRuleRecord {
  // ── YAML parse ── syntax errors and DUPLICATE KEYS are hard errors naming the
  // file (`yaml`'s `uniqueKeys` default): a duplicate key would silently pick one
  // value, which is the silent-transform class this grammar exists to kill.
  //
  // NO parse options are passed, so the alias-expansion ceiling the cycle/DAG
  // scan below inherits is `yaml`'s own `maxAliasCount` default of 100 — if a
  // later slice passes options here, or the `yaml` major moves, that bound moves
  // with it and the ancestor-stack guard's cost profile must be re-verified.
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (err) {
    throw new RuleRecordParseError(
      filePath,
      '(document)',
      `invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      'Fix the YAML syntax; duplicate keys are rejected too — one rule is one well-formed YAML document (Prop 310 § Design 1).',
      err,
    );
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new RuleRecordParseError(
      filePath,
      '(document)',
      'record is not a YAML mapping — one rule is one YAML document (Prop 310 § Design 1)',
      FIX_THE_RECORD,
    );
  }
  const raw = doc as Record<string, unknown>;

  // ── § Design 2 — the no-silent-skip version gate, FIRST ──
  // Ahead of the § Design 4 key scan on purpose: the inexpressible SET is V1's,
  // so it may only be applied to a document that declares V1. A future version
  // could re-admit a key V1 reserves — `version:` itself is § Design 3's named
  // "can return by version bump" candidate — and diagnosing such a record as
  // producer-owned would name the wrong defect. The version answers "whose rules
  // apply" and therefore has to answer first. (The `target.type` gate stays AFTER
  // the scan: an unknown type does not change WHICH grammar version's key set is
  // in force, so no analogous misdiagnosis exists there.)
  const rawVersion = raw.schemaVersion;
  if (rawVersion === undefined) {
    throw new RuleRecordParseError(
      filePath,
      'schemaVersion',
      `every record opens with \`schemaVersion: ${RULE_RECORD_SCHEMA_VERSION}\` (Prop 310 § Design 2/§ Design 5)`,
      FIX_THE_RECORD,
    );
  }
  if (
    typeof rawVersion !== 'number' ||
    !Number.isInteger(rawVersion) ||
    rawVersion !== RULE_RECORD_SCHEMA_VERSION
  ) {
    throw new RuleRecordNoSilentSkipError(
      filePath,
      'schemaVersion',
      `unknown schemaVersion ${JSON.stringify(rawVersion)} — this consumer implements version ${RULE_RECORD_SCHEMA_VERSION} only`,
    );
  }

  // ── § Design 4 — inexpressible keys, scanned at every depth (+ cycle guard) ──
  assertNoInexpressibleKeys(filePath, raw, '', new WeakSet<object>());

  // ── § Design 2/§ Design 6 — the no-silent-skip target-type gate ──
  const rawTarget = raw.target;
  if (rawTarget !== null && typeof rawTarget === 'object' && !Array.isArray(rawTarget)) {
    const rawType = (rawTarget as Record<string, unknown>).type;
    // R16 — `ast` is not "not yet"; it is DROPPED from the authoring surface and
    // does not return by version bump. Telling the author otherwise would send
    // them to wait for a bump that will never carry it. The comparison case-folds
    // and trims for DIAGNOSTIC SELECTION ONLY — `AST` / `Ast` / `ast ` are the
    // same authoring mistake and deserve the same answer. ADMISSION is unchanged:
    // it runs on the RAW value against the closed, case-sensitive V1 enum below,
    // so a near-miss is still rejected, just told the truth about why.
    if (
      typeof rawType === 'string' &&
      rawType.trim().toLowerCase() === LEGACY_INERT_ENGINE &&
      !RuleTargetTypeSchema.safeParse(rawType).success
    ) {
      throw new RuleRecordNoSilentSkipError(filePath, 'target.type', LEGACY_ENGINE_DETAIL);
    }
    if (rawType !== undefined && !RuleTargetTypeSchema.safeParse(rawType).success) {
      throw new RuleRecordNoSilentSkipError(
        filePath,
        'target.type',
        `unknown target.type ${JSON.stringify(rawType)} — the V1 enum is \`ast-grep | regex\`; \`rego\` and ADR-109's action-rule type join by grammar version bump (§ Design 6)`,
      );
    }
  }

  // ── § Design 8 — `scope: block` is reserved-unimplemented, not a parse value ──
  const rawRequires = raw.requires;
  if (rawRequires !== null && typeof rawRequires === 'object' && !Array.isArray(rawRequires)) {
    const rawScope = (rawRequires as Record<string, unknown>).scope;
    if (rawScope === REQUIRES_SCOPE_RESERVED) {
      throw new RuleRecordNoSilentSkipError(
        filePath,
        'requires.scope',
        '`scope: block` is RESERVED-UNIMPLEMENTED at V1 — the name space reserves `line | block | file`, and `block` awaits a language adapter’s boundary definition (§ Design 8)',
      );
    }
  }

  // ── Full closed-key validation (§§ Design 4–9) + the § Design 7 glob dialect ──
  const parsed = RuleRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const first = issues[0];
    const keyPath = first !== undefined && first.path.length > 0 ? first.path.join('.') : '(root)';
    const detail = issues
      .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('; ');
    throw new RuleRecordParseError(filePath, keyPath, detail, FIX_THE_RECORD, parsed.error);
  }
  const record = parsed.data;

  return {
    record,
    derivedEngine: record.target.type,
    examplePairHashes: record.examples.map((example, ordinal) => ({
      ordinal,
      hash: ruleExamplePairHash(example),
    })),
  };
}
