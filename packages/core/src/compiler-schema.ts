import { z } from 'zod';

// ─── NapiConfig / compound ast-grep rule schemas ────

/**
 * Schema mirroring `@ast-grep/napi`'s `NapiConfig` interface for compound
 * structural rules. The `rule` key is required at the Zod layer so the
 * parse-time failure is loud and readable; the inner tree shape is handed
 * off to `@ast-grep/napi` at the engine boundary for the authoritative
 * validity check (see `validateAstGrepPattern`). `passthrough()` lets
 * future napi fields (e.g. `constraints`, `transform`) survive a parse
 * without a schema bump.
 *
 * The rule body is a recursive structural tree (combinators like `all`,
 * `any`, `not`, `inside`, `has`, `precedes`, `follows`). Rather than
 * modelling the full recursive schema with `z.lazy()`, we accept any
 * object shape here and lean on napi to reject malformed trees. That
 * keeps the Zod layer cheap and the authoritative check centralized.
 */
export const NapiConfigSchema = z
  .object({
    rule: z.record(z.unknown()),
  })
  .passthrough();

export type NapiConfig = z.infer<typeof NapiConfigSchema>;

/**
 * Named alias of `NapiConfigSchema` for grep-ability. The field on
 * `CompiledRule` is named `astGrepYamlRule` (see ADR-087); the alias
 * lets a reader search for `AstGrepYamlRuleSchema` and land on the
 * right definition without first knowing it's a napi config.
 */
export const AstGrepYamlRuleSchema = NapiConfigSchema;

export type AstGrepYamlRule = NapiConfig;

// ─── Compiled rule schemas ──────────────────────────

const CompiledRuleBaseSchema = z.object({
  /** SHA-256 hash (first 16 hex chars) of heading + body — detects edits */
  lessonHash: z.string(),
  /** Human-readable heading from the lesson (for diagnostics) */
  lessonHeading: z.string(),
  /** Regex pattern to match against added diff lines */
  pattern: z.string(),
  /** Human-readable violation message shown when the pattern matches */
  message: z.string(),
  /** Engine type — 'regex' for line-level matching, 'ast' for Tree-sitter S-expression queries, 'ast-grep' for ast-grep structural patterns */
  engine: z.enum(['regex', 'ast', 'ast-grep']),
  /** Tree-sitter S-expression query (required when engine is 'ast') */
  astQuery: z.string().optional(),
  /**
   * Flat ast-grep pattern source (a single JS/TS expression). Mutually
   * exclusive with `astGrepYamlRule` when `engine === 'ast-grep'`; the
   * superRefine below enforces that.
   */
  astGrepPattern: z.string().optional(),
  /**
   * Compound ast-grep rule (NapiConfig shape). Holds structural trees
   * that cannot be expressed as a single source snippet (all / any /
   * not / inside / has / precedes / follows combinators). Mutually
   * exclusive with `astGrepPattern`; see the superRefine on this
   * schema. Smoke-test wiring lands in mmnto/totem#1408.
   */
  astGrepYamlRule: AstGrepYamlRuleSchema.optional(),
  /**
   * Optional code snippet the rule is expected to match. Stored from
   * compiler output so the smoke-test runner (wired in
   * mmnto/totem#1408) can re-validate the rule offline. Optional in
   * 1.14.9; flips to required when #1408 turns on the gate.
   */
  badExample: z.string().optional(),
  /**
   * Optional code snippet the rule MUST NOT match. mmnto-ai/totem#1580
   * added the over-matching check: the compile-time smoke gate runs the
   * rule against `goodExample` and rejects it with reason code
   * `'matches-good-example'` if the pattern fires. Optional at the
   * persisted-rule boundary for backward compatibility with pre-#1580
   * rules; `CompilerOutputSchema` requires it for regex and ast-grep
   * producers (see `refineGoodExampleRequired`).
   */
  goodExample: z.string().optional(),
  /** ISO timestamp of when this rule was compiled */
  compiledAt: z.string(),
  /** ISO timestamp of when this rule was first created (survives recompilation) */
  createdAt: z.string().optional(),
  /** Optional file glob patterns — rule only applies to matching files (e.g., ["*.sh", "*.yml"]) */
  fileGlobs: z.array(z.string()).optional(),
  /** Rule category for Trap Ledger classification */
  category: z.enum(['security', 'architecture', 'style', 'performance']).optional(),
  /** Severity level — error blocks CI, warning reports but doesn't fail */
  severity: z.enum(['error', 'warning']).optional(),
  /** Lifecycle status — active rules are enforced, archived rules are skipped */
  status: z.enum(['active', 'archived']).optional(),
  /** Reason for archiving (when status is 'archived') */
  archivedReason: z.string().optional(),
  /**
   * ISO timestamp of when the rule was first archived (mmnto-ai/totem#1589).
   * Preserved across compile-write round-trips so the institutional-ledger
   * semantic of first-archive-provenance survives. Pre-#1589 Zod parses
   * silently stripped this field during schema round-trips; every compile
   * cycle erased prior `archivedAt` values from the rules file. Postmerge
   * archive scripts (`scripts/archive-postmerge-*.cjs`) set this via raw
   * JSON mutation; the field is additive on the schema side so manual
   * archive workflows survive a subsequent `totem lesson compile --export`.
   */
  archivedAt: z.string().optional(),
  /**
   * True for rules generated by Pipeline 1 (manual `**Pattern:**` blocks). Set to
   * `true` in `buildManualRule`. Used by `doctor.ts:checkUpgradeCandidates` and
   * `compile.ts:logCompiledRule` to identify manual rules without relying on the
   * fragile `lessonHeading === message` heuristic — that heuristic only worked
   * pre-#1265 when manual rules had no way to express a custom message and the
   * compiler hardcoded `message: lesson.heading`. After #1265 added Pipeline 1
   * Message field support, manual rules can now have rich messages distinct from
   * their headings, breaking the heuristic. The `manual` flag is the reliable
   * post-#1265 signal. Optional + missing for backward compat with pre-#1265
   * compiled-rules.json files; the legacy heuristic stays as a fallback.
   */
  manual: z.boolean().optional(),
  /**
   * Schema marker for ADR-089 Zero-Trust enforcement.
   * Readers:
   * - #1485 pack-merge path refuses downgrade to warning/archived locally.
   * - #1479 Layer 3 security branch rejects outright on verify failure.
   */
  immutable: z.boolean().optional(),
  /**
   * ADR-088 Phase 1 Layer 3 (mmnto-ai/totem#1480). True when the rule was
   * compiled from a lesson that lacked an Example Hit block, meaning no
   * ground-truth fixture exists to verify the pattern against. Pipeline 2
   * / Pipeline 3 / Pipeline 1 writers set this when the lesson body carries
   * no `**Example Hit:**` field. Security rules with `immutable === true`
   * or `deps.securityContext === true` are rejected outright rather than
   * shipped unverified (see compile-lesson.ts).
   *
   * Absent (undefined) means the rule is verified. Never write literal
   * `false`; absence preserves pre-#1480 manifest hashes via
   * canonicalStringify — `{unverified: undefined}` and an absent key
   * produce identical output.
   */
  unverified: z.boolean().optional(),
});

/**
 * Shared mutual-exclusion check between the flat `astGrepPattern` string
 * and the structural `astGrepYamlRule` object. Used by both
 * `CompiledRuleSchema` and `CompilerOutputSchema` so the gate fires at
 * both the LLM-output boundary and the persisted-rule boundary. Empty
 * strings count as "not present" because `engineFields` writes
 * `pattern: ''` alongside every ast-grep rule.
 */
function refineAstGrepMutualExclusion(
  data: {
    engine?: 'regex' | 'ast' | 'ast-grep';
    astGrepPattern?: string;
    astGrepYamlRule?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  if (data.engine !== 'ast-grep') return;
  const hasPattern = typeof data.astGrepPattern === 'string' && data.astGrepPattern.length > 0;
  const hasYaml = data.astGrepYamlRule !== undefined;
  if (hasPattern && hasYaml) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ast-grep rule cannot define both astGrepPattern and astGrepYamlRule',
      path: ['astGrepYamlRule'],
    });
  }
  if (!hasPattern && !hasYaml) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ast-grep rule must define either astGrepPattern or astGrepYamlRule',
      path: ['astGrepPattern'],
    });
  }
}

export const CompiledRuleSchema = CompiledRuleBaseSchema.superRefine(refineAstGrepMutualExclusion);

export type CompiledRule = z.infer<typeof CompiledRuleSchema>;

/**
 * Machine-readable reason for why a lesson could not be compiled into a rule.
 * mmnto-ai/totem#1481 upgraded the `nonCompilable` ledger from opaque 2-tuples
 * to 4-tuples with an explicit reason code so `totem doctor` and downstream
 * telemetry can distinguish outcomes without string-matching.
 *
 * Enum order matches the compile-pipeline exit points (see compile-lesson.ts)
 * followed by the legacy migration sentinel. `'legacy-unknown'` exists only
 * so data written by pre-#1481 compile runs (2-tuple shape) round-trips
 * through the Read schema, up-converts in memory, and re-persists without
 * losing the hash/title pair. Fresh compile runs MUST NOT emit
 * `'legacy-unknown'`; enforcement sits at producers, not the schema.
 */
export const NonCompilableReasonCodeSchema = z.enum([
  'no-pattern-generated',
  'pattern-syntax-invalid',
  'pattern-zero-match',
  'verify-retry-exhausted',
  'security-rule-rejected',
  'no-pattern-found',
  'out-of-scope',
  'missing-badexample',
  'missing-goodexample',
  'matches-good-example',
  // `context-required` (mmnto-ai/totem#1598) classifies lessons whose hazard
  // is scope-bounded by a context (e.g., "inside X", "only for NEW items")
  // that cannot be captured structurally in a single-line regex or ast-grep
  // pattern. Distinct from `out-of-scope` (conceptual / architectural) —
  // context-required lessons describe real code defects; the compiler simply
  // cannot produce a non-false-positive-prone rule.
  'context-required',
  'legacy-unknown',
]);

export type NonCompilableReasonCode = z.infer<typeof NonCompilableReasonCodeSchema>;

/**
 * Strict Write schema for `nonCompilable` entries. Every persisted entry
 * carries the 4-tuple `{hash, title, reasonCode, reason?}` shape. Accepts
 * `'legacy-unknown'` so migrated pre-#1481 2-tuples round-trip to disk
 * safely on the first post-upgrade compile; the behavioral invariant that
 * fresh producers never emit `'legacy-unknown'` lives at the call sites,
 * not here.
 *
 * Design precedent: lesson 400fed87 (Read/Write schema invariants). If
 * writes routed through the permissive Read schema, the union-plus-
 * transform pipeline would silently re-accept legacy 2-tuples on every
 * save and the migration would never complete.
 */
export const NonCompilableEntryWriteSchema = z.object({
  hash: z.string(),
  title: z.string(),
  reasonCode: NonCompilableReasonCodeSchema,
  reason: z.string().optional(),
});

/**
 * Permissive Read schema for `nonCompilable` entries. Accepts three shapes:
 *   - Legacy string (pre-#1280): just the hash.
 *   - Legacy 2-tuple (#1280 to #1481): `{hash, title}`.
 *   - Modern 4-tuple (#1481+): `{hash, title, reasonCode, reason?}`.
 * The transform normalizes every shape to the modern 4-tuple. Legacy shapes
 * get `reasonCode: 'legacy-unknown'` and no `reason`.
 */
export const NonCompilableEntryReadSchema = z
  .union([
    z.string(),
    // Modern 4-tuple MUST come before the legacy 2-tuple in the union so
    // Zod's left-to-right matching grabs the richer shape first. If the
    // legacy 2-tuple sat ahead of the modern one, a full 4-tuple would
    // match the 2-tuple schema (which requires only `hash` + `title`) and
    // silently drop `reasonCode` / `reason` before transform could see them.
    NonCompilableEntryWriteSchema,
    z.object({
      hash: z.string(),
      title: z.string(),
    }),
  ])
  .transform((entry) => {
    if (typeof entry === 'string') {
      return { hash: entry, title: '(legacy entry)', reasonCode: 'legacy-unknown' as const };
    }
    if ('reasonCode' in entry) {
      return entry;
    }
    return { hash: entry.hash, title: entry.title, reasonCode: 'legacy-unknown' as const };
  });

/**
 * Public `NonCompilableEntry` type is the inferred 4-tuple shape (post-Read
 * transform). Downstream code only ever sees this shape.
 */
export type NonCompilableEntry = z.infer<typeof NonCompilableEntryReadSchema>;

export const CompiledRulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(CompiledRuleSchema),
  /**
   * Lessons that could not be compiled into a rule. 4-tuple shape since
   * mmnto-ai/totem#1481: {hash, title, reasonCode, reason?}. The Read
   * schema accepts the pre-#1280 string shape and the #1280-era 2-tuple
   * and migrates both to the 4-tuple with `reasonCode: 'legacy-unknown'`.
   * Every write site MUST route through `NonCompilableEntryWriteSchema`
   * (or an equivalent structural check) to prevent the permissive Read
   * transform from legitimizing legacy shapes on save.
   */
  nonCompilable: z.array(NonCompilableEntryReadSchema).optional(),
});

export type CompiledRulesFile = z.infer<typeof CompiledRulesFileSchema>;

// ─── Compiler output schema ─────────────────────────

/** Schema for the structured JSON the LLM returns when compiling a lesson. */
const CompilerOutputBaseSchema = z.object({
  compilable: z.boolean(),
  pattern: z.string().optional(),
  message: z.string().optional(),
  fileGlobs: z.array(z.string()).optional(),
  engine: z.enum(['regex', 'ast', 'ast-grep']).optional(),
  astQuery: z.string().optional(),
  /** Flat ast-grep pattern source. Mutually exclusive with `astGrepYamlRule`. */
  astGrepPattern: z.string().optional(),
  /** Compound ast-grep rule (NapiConfig). Mutually exclusive with `astGrepPattern`. */
  astGrepYamlRule: AstGrepYamlRuleSchema.optional(),
  /**
   * Code snippet the rule is expected to match. Flipped from optional to
   * engine-conditional required in mmnto-ai/totem#1409 - regex and
   * ast-grep rules must carry a non-empty snippet so the compile-time
   * smoke gate (#1408) can execute the rule against known-bad code
   * before it lands in compiled-rules.json. The Zod field stays
   * optional here; the `refineBadExampleRequired` superRefine below
   * enforces the engine-conditional requirement so the error message
   * can name the engine and cite the ticket.
   */
  badExample: z.string().optional(),
  /**
   * Code snippet the rule MUST NOT match. Flipped from optional to
   * engine-conditional required in mmnto-ai/totem#1580 - regex and
   * ast-grep rules must carry a non-empty snippet so the compile-time
   * smoke gate can assert the pattern does not over-match on known-good
   * code before it lands in compiled-rules.json. The Zod field stays
   * optional here; the `refineGoodExampleRequired` superRefine below
   * enforces the engine-conditional requirement so the error message
   * can name the engine and cite the ticket.
   */
  goodExample: z.string().optional(),
  severity: z.enum(['error', 'warning']).optional(),
  /** LLM explanation for why a lesson was marked non-compilable */
  reason: z.string().optional(),
  /**
   * LLM-emittable classifier code (mmnto-ai/totem#1598). Narrower than
   * `NonCompilableReasonCodeSchema` because most reason codes
   * (`verify-retry-exhausted`, `missing-badexample`, `security-rule-rejected`,
   * etc.) are emitted by core routing, not the LLM. Exposing the full enum
   * to the LLM would let it bypass core classification by forging an
   * internal sentinel. This narrow enum lists only the codes the compile
   * prompt is allowed to produce.
   *
   * Only valid when `compilable === false`. Enforced by
   * `refineReasonCodeRequiresNonCompilable` below.
   */
  reasonCode: z.enum(['context-required']).optional(),
});

/**
 * Enforce that Pipeline 2 / Pipeline 3 LLM output carries a non-empty
 * `badExample` for every rule whose engine is covered by the compile-time
 * smoke gate (regex and ast-grep, per mmnto-ai/totem#1408). The `ast`
 * engine (Tree-sitter S-expression queries) is exempt because the smoke
 * gate does not yet evaluate those rules - forcing `badExample` there
 * would reject every ast-engine rule the LLM emits today.
 *
 * An absent `engine` field counts as `regex` because `buildCompiledRule`
 * defaults a missing engine to regex. Without that equivalence the LLM
 * could omit `engine` and bypass the gate silently.
 *
 * Applies only to compilable rules. Non-compilable output carries
 * `reason` instead of a rule and has nothing for the gate to execute.
 */
function refineBadExampleRequired(
  data: {
    compilable: boolean;
    engine?: 'regex' | 'ast' | 'ast-grep';
    badExample?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (!data.compilable) return;
  const engineRequiresBadExample = data.engine !== 'ast';
  if (!engineRequiresBadExample) return;
  // `.trim().length > 0` rather than `.length > 0` because the smoke gate
  // treats whitespace-only snippets as no-ops via its own early-return,
  // so a blank string would slip through schema validation but provide
  // zero gate coverage. Flagged by CodeRabbit on mmnto-ai/totem#1591 for
  // `goodExample`; the same hole existed on `badExample` since #1409.
  if (typeof data.badExample === 'string' && data.badExample.trim().length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      'badExample is required (non-empty string) for regex and ast-grep engines (mmnto-ai/totem#1409)',
    path: ['badExample'],
  });
}

/**
 * Symmetric counterpart of `refineBadExampleRequired` for the over-matching
 * check shipped in mmnto-ai/totem#1580. Every Pipeline 2 / Pipeline 3
 * compilable rule must carry a non-empty `goodExample` so the smoke gate
 * can assert the pattern does not fire on known-good code. Same engine
 * carve-out as badExample: `ast` engine exempt because the gate does not
 * yet evaluate Tree-sitter S-expression queries.
 */
function refineGoodExampleRequired(
  data: {
    compilable: boolean;
    engine?: 'regex' | 'ast' | 'ast-grep';
    goodExample?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (!data.compilable) return;
  const engineRequiresGoodExample = data.engine !== 'ast';
  if (!engineRequiresGoodExample) return;
  // `.trim().length > 0` rather than `.length > 0` so a whitespace-only
  // goodExample cannot satisfy the required-field check. The smoke gate's
  // early-return on `snippet.trim().length === 0` would treat the blank
  // string as a no-op, producing zero over-matching coverage.
  if (typeof data.goodExample === 'string' && data.goodExample.trim().length > 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      'goodExample is required (non-empty string) for regex and ast-grep engines (mmnto-ai/totem#1580)',
    path: ['goodExample'],
  });
}

/**
 * `reasonCode` is meaningful only when the LLM classifies a lesson as
 * non-compilable. Compilable output carries a pattern + examples, not a
 * classifier code. Enforcing the asymmetry at the schema prevents the LLM
 * from emitting contradictory output like `{compilable: true, reasonCode: 'context-required'}`.
 */
function refineReasonCodeRequiresNonCompilable(
  data: { compilable: boolean; reasonCode?: string },
  ctx: z.RefinementCtx,
): void {
  if (data.reasonCode === undefined) return;
  if (!data.compilable) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'reasonCode is only valid when compilable is false (mmnto-ai/totem#1598)',
    path: ['reasonCode'],
  });
}

export const CompilerOutputSchema = CompilerOutputBaseSchema.superRefine((data, ctx) => {
  refineAstGrepMutualExclusion(data, ctx);
  refineBadExampleRequired(data, ctx);
  refineGoodExampleRequired(data, ctx);
  refineReasonCodeRequiresNonCompilable(data, ctx);
});

export type CompilerOutput = z.infer<typeof CompilerOutputSchema>;

// ─── Violation type ─────────────────────────────────

export interface Violation {
  /** The rule that was violated */
  rule: CompiledRule;
  /** The file path from the diff where the violation occurred */
  file: string;
  /** The matching line content */
  line: string;
  /** 1-based line number within the diff hunk (approximate) */
  lineNumber: number;
}

// ─── Diff types ─────────────────────────────────────

/** Syntactic context of a diff line, determined by AST analysis. */
export type AstContext = 'code' | 'string' | 'comment' | 'regex';

export interface DiffAddition {
  file: string;
  line: string;
  lineNumber: number;
  /** Content of the preceding line in the new file (context or added), null if first in hunk */
  precedingLine: string | null;
  /** Syntactic context from AST analysis — undefined means not classified (fail-open as code) */
  astContext?: AstContext;
}

// ─── Shared types ───────────────────────────────────

export interface RegexValidation {
  valid: boolean;
  reason?: string;
}

/** Context passed alongside rule events for Trap Ledger integration. */
export interface RuleEventContext {
  file: string;
  line: number;
  justification?: string;
  /** AST context where the rule fired (code, string, comment, regex). */
  astContext?: AstContext;
  /**
   * Populated on `'failure'` events only. Holds the error message surfaced by
   * the runtime engine (ast-grep `findAll`, regex `exec`, etc.) so `totem
   * doctor` telemetry can aggregate rules that fail at execution time. Not
   * used by `'trigger'` or `'suppress'` events. Kept as a string rather than
   * the raw `unknown` so the callback interface stays cheap to consume.
   */
  failureReason?: string;
  /**
   * True when the rule that fired this event was shipped by a pack with
   * `immutable: true`. Threaded through so downstream ledger writers can
   * flag immutable-rule bypass events for pack enforcement audit (ADR-089,
   * mmnto-ai/totem#1485). Absent on events from non-immutable rules.
   */
  immutable?: boolean;
}

/**
 * Callback for observability - invoked when a rule is suppressed, triggered,
 * or fails at runtime. The `'failure'` variant was added in mmnto/totem#1408
 * alongside per-rule try/catch in `executeQuery`. It is intentionally distinct
 * from `'suppress'`: suppression is a user-initiated directive (totem-ignore /
 * totem-context), while failure is a runtime engine error on a rule that
 * otherwise compiled. The #1412 postmerge GCA fix established this boundary,
 * so the two values must NEVER be conflated in the Trap Ledger.
 */
export type RuleEventCallback = (
  event: 'trigger' | 'suppress' | 'failure',
  lessonHash: string,
  context?: RuleEventContext,
) => void;
