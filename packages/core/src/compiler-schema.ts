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

// ─── Legitimacy marker (mmnto-ai/totem#2183) ────────

/**
 * Full 40-hex git commit SHA, lowercase. (Git content hashes elsewhere are
 * 64-hex sha-256; a commit SHA is sha-1.) Lowercase-only is deliberate, not an
 * oversight (GCA #2186): git emits canonical lowercase SHA-1, and the sole
 * writer of `commitSha` is spine regeneration (strategy#516) deriving from git,
 * so the canonical form is always lowercase. We validate that canonical form
 * rather than accepting uppercase (`/i`) — admitting a non-canonical SHA would
 * be a silent data-quality hole, and lower-casing it on parse would reintroduce
 * the very transform/hash-stability hazard flagged for `reviewThread` below.
 */
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

/**
 * ADR-112 §4/§8 — the codomain of an IMMUTABLE lesson reference: the 16-hex
 * `hashLesson` id (`compile-lesson.ts`). A `lessonRef` MUST be this immutable id,
 * never a path (`docs/lessons/foo.md`) or a mutable alias (`latest`) — a drifting
 * anchor would break the §4 preimage-differential's identity discipline. Pinned
 * to the codomain so a path/alias fails LOUD at the schema boundary. NOTE
 * (couple-on-merge, strategy#767): bound to the current 16-hex `hashLesson` form;
 * widen here if the lesson-id codomain ever changes.
 */
const LESSON_REF_RE = /^[0-9a-f]{16}$/;

/**
 * ISO-8601 shape for an authoring date — a calendar date (`YYYY-MM-DD`) or a full
 * timestamp with optional fractional seconds + `Z`/offset. Shape only; the calendar
 * validity is enforced by `isIso8601CalendarDate` (#2259 — GCA-high + CR).
 */
const ISO_8601_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * True iff `s` is a well-formed ISO-8601 date/timestamp AND a REAL calendar date.
 * `Date.parse` alone is insufficient: it NORMALIZES day-overflow (`2026-02-31` → Mar 3,
 * `2026-02-29` non-leap → Mar 1) instead of rejecting it (#2259 CR re-review). The
 * `Date.UTC` round-trip validates the date HEAD's calendar independently of any timezone
 * in the time component — a negative offset can legitimately shift the UTC day, so the
 * head, not the parsed instant, is what must round-trip.
 */
export function isIso8601CalendarDate(s: string): boolean {
  if (!ISO_8601_DATE_RE.test(s) || Number.isNaN(Date.parse(s))) return false;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() + 1 === m && probe.getUTCDate() === d;
}

/**
 * mmnto-ai/totem#2183 — the §3.1 provenance leg of the ADR-110 Gate-1
 * legitimacy bar: the identity of the merged-PR history a regenerated rule was
 * mined from. Structured and **mechanically validated** (NOT a bare string) so
 * a placeholder cannot masquerade as provenance. Promotion state is NOT carried
 * here — it lives on the owning rule's top-level `unverified` flag (ADR-089
 * zero-trust), the single source of truth `deriveRuleClass` reads. Control
 * *evidence* (which PRs/fixtures proved each control) rides the wind-tunnel
 * manifest (ADR-110 §6), not the per-rule marker.
 *
 * **ADR-112 — this is the MINED variant of the `ProvenanceRecord` union.** The
 * wire shape is otherwise UNCHANGED: `kind` is OPTIONAL and absent on every
 * pre-ADR-112 record, so a legacy mined provenance parses + reserializes
 * BYTE-IDENTICAL (no added key — `canonicalStringify` omits the undefined
 * discriminator exactly as it omits an absent `unverified`), preserving the
 * non-mutating-refine manifest-hash discipline. Absence ⇒ `'mined'` via
 * `provenanceKind()`; the miner path types its provenance as
 * `MinedProvenanceRecord` (the documented mining-only boundary), so its readers
 * of `mergedPr` / `commitSha` stay type-safe without narrowing.
 */
export const MinedProvenanceWireSchema = z.object({
  /**
   * ADR-112 discriminator. OPTIONAL on the mined wire so legacy records (which
   * have no `kind`) round-trip byte-identical; absence is read as `'mined'` by
   * `provenanceKind()`. A new mined artifact MAY carry `kind: 'mined'` only
   * where the resulting hash churn is intentional.
   */
  kind: z.literal('mined').optional(),
  /** Merged PR the rule was mined from (positive integer PR number). */
  mergedPr: z.number().int().positive(),
  /**
   * Reference to the review thread that adjudicated the rule. Rejects empty and
   * whitespace-only via a NON-MUTATING refinement (greptile/CR #2186): a
   * `.trim()` transform would silently normalize a padded value on parse, so a
   * stamped rule's on-disk JSON could differ from its parsed form and churn the
   * manifest hash on the next `verify-manifest`. `.refine` validates without
   * mutating, so the stored value round-trips byte-identically.
   */
  reviewThread: z.string().refine((s) => s.trim().length > 0, {
    message: 'reviewThread must be a non-empty, non-whitespace reference',
  }),
  /** Full 40-hex git commit SHA the rule was frozen at. */
  commitSha: z.string().regex(COMMIT_SHA_RE),
});

export type MinedProvenanceRecord = z.infer<typeof MinedProvenanceWireSchema>;

/**
 * ADR-112 §4 — the preimage-differential SOURCE for one fixture, a discriminated
 * union on `kind` (declared PER FIXTURE; not a fixed binding to landed commits).
 * The materializer (slice C/D) fires the matcher on the preimage and asserts it
 * is SILENT on the postimage — a matcher that fires only on the fixed form is
 * fix-shaped and is NOT a legitimate positive control (FM(i)):
 *   - `lesson` (PRIMARY, review-caught repos): the lesson corpus' `badExample`
 *     (preimage — fire) / `goodExample` (postimage — silent). `lessonRef` is an
 *     IMMUTABLE lesson id/hash (the `hashLesson` codomain, `LESSON_REF_RE`),
 *     never a path/mutable alias (§8 identity discipline).
 *   - `commit` (FALLBACK, land-then-fix repos): the pre-fix parent
 *     (`preimageCommitSha` — fire) / post-fix merge (`mergeCommitSha` — silent).
 *
 * `z.discriminatedUnion` (not `z.union`): both branches carry a REQUIRED literal
 * `kind`, so Zod routes a parse error to the matched branch instead of emitting
 * "no union member matched" noise (cf. `cert-corpus-seed.ts`'s `window`). The
 * OPTIONAL-discriminator round-trip reason `ProvenanceRecordSchema` documents for
 * its `z.union` does NOT apply — `preimageSource` is a new field with no persisted
 * authored set. Each branch is `.strict()` so a cross-branch key (e.g. a
 * `badExample` under `kind:'commit'`) fails LOUD (FM(d) posture) rather than being
 * silently stripped. All refines are NON-mutating (no `.trim()`) to preserve the
 * manifest-hash stability discipline.
 */
export const PreimageSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('lesson'),
      /** IMMUTABLE lesson id/hash (the 16-hex `hashLesson` codomain) — never a path/mutable alias (§4/§8). */
      lessonRef: z.string().regex(LESSON_REF_RE, {
        message:
          'lessonRef must be an immutable lesson id (16-hex hashLesson codomain), not a path or mutable alias',
      }),
      /**
       * The defect PREIMAGE exemplar the matcher must FIRE on (§4). This is a lesson
       * corpus `badExample` — distinct from `CompiledRuleBaseSchema.badExample` (an
       * optional human-readable code snippet on a compiled rule); here it is the
       * load-bearing positive-control preimage, so non-empty is required.
       */
      badExample: z.string().refine((s) => s.trim().length > 0, {
        message: 'badExample (the defect preimage the matcher must fire on) must be non-empty',
      }),
      /** The fixed POSTIMAGE exemplar the matcher must stay SILENT on (§4) — a lesson `goodExample`. */
      goodExample: z.string().refine((s) => s.trim().length > 0, {
        message: 'goodExample (the fixed form the matcher must stay silent on) must be non-empty',
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('commit'),
      /** The PARENT (pre-fix) commit where the DEFECT is present — the matcher must FIRE on this (ADR-112 §4). */
      preimageCommitSha: z.string().regex(COMMIT_SHA_RE, {
        message: 'preimageCommitSha must be a 40-character lowercase hex commit SHA',
      }),
      /** The PR's merge/squash commit — the post-fix (defect-absent) anchor; the matcher must stay SILENT on this. */
      mergeCommitSha: z.string().regex(COMMIT_SHA_RE, {
        message: 'mergeCommitSha must be a 40-character lowercase hex commit SHA',
      }),
    })
    .strict(),
]);

export type PreimageSource = z.infer<typeof PreimageSourceSchema>;

/**
 * ADR-112 §3 — one real lc instance an authored rule claims to catch. ALL such
 * fixtures are TRAIN-side (the §5 leakage guard); the preimage-differential
 * (§4) is evaluated in slice C/D, but the record CARRIES the declared
 * `preimageSource` (lesson | commit) + the defect locus here so derivation is
 * possible. `matchedSpan` + `contentHash` are the line-drift-stable locus
 * (cf. `firingLabelId`), not just the file.
 */
export const AuthoredFixtureSchema = z
  .object({
    /** The PR where the defect was caught/introduced (the in-corpus anchor). */
    pr: z.number().int().positive(),
    /** The §4 preimage-differential source — lesson-anchored (PRIMARY) or commit-pair (FALLBACK). */
    preimageSource: PreimageSourceSchema,
    /** File the defect locus lives in. */
    filePath: z.string().refine((s) => s.trim().length > 0, {
      message: 'filePath must be a non-empty reference',
    }),
    /** Line-range or AST-node path — the defect locus, not just the file. */
    matchedSpan: z.string().refine((s) => s.trim().length > 0, {
      message: 'matchedSpan must be a non-empty locus',
    }),
    /** Span content hash, line-drift-stable (cf. `firingLabelId`). */
    contentHash: z.string().refine((s) => s.trim().length > 0, {
      message: 'contentHash must be a non-empty hash',
    }),
  })
  // `.strict()` (CR outside-diff): the outer fixture closes too, not just the union branches —
  // a partially-migrated fixture carrying `preimageSource` AND a leftover flat `mergeCommitSha`/
  // `preimageCommitSha` must fail LOUD, never validate-and-silently-strip the stale key (FM(d)).
  .strict()
  // ANTI-VACUITY FAST-FAIL (GCA finding; strategy#767-blessed defense-in-depth). This is NOT the
  // §4 preimage-differential — that is the load-bearing C/D materializer (fire-on-preimage /
  // silent-on-postimage). This only rejects the DEGENERATE case where the two sides are IDENTICAL:
  // an identical preimage/postimage is an UNCONDITIONALLY vacuous control (a matcher cannot fire on
  // one and stay silent on the other), so it is zero-false-positive to reject at intake — distinct
  // from "does the differential hold", which two *different* sides still must prove in C/D.
  // Non-mutating (compares trimmed, never transforms) — manifest-hash stability. A `superRefine` on
  // the OUTER fixture (not a branch `.refine`, which would wrap a `discriminatedUnion` member in a
  // ZodEffects and break discriminator extraction).
  .superRefine((fixture, ctx) => {
    const src = fixture.preimageSource;
    if (src.kind === 'lesson' && src.badExample.trim() === src.goodExample.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'badExample and goodExample must differ — identical sides are a vacuous preimage-differential control (ADR-112 §4)',
        path: ['preimageSource', 'goodExample'],
      });
    }
    if (src.kind === 'commit' && src.preimageCommitSha === src.mergeCommitSha) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'preimageCommitSha and mergeCommitSha must differ — an identical pre/post commit is a vacuous preimage-differential control (ADR-112 §4)',
        path: ['preimageSource', 'mergeCommitSha'],
      });
    }
  });

export type AuthoredFixture = z.infer<typeof AuthoredFixtureSchema>;

/**
 * ADR-112 §3 — the AUTHORED variant of the `ProvenanceRecord` union. A
 * hand-authored rule is anchored to a real historical DEFECT (the pre-image,
 * NOT its fix — ADR-110 §4 TP-def) via ≥1 train-side `positiveFixtures` entry.
 * `kind: 'authored'` is REQUIRED (the discriminator), so this can never be
 * mistaken for a mined record and an authored record can never round-trip as
 * mined. Attributable (`author` never anonymous); the embargo/ledger
 * attestations ride the §8 authoring-ledger, not this marker.
 */
export const AuthoredProvenanceRecordSchema = z.object({
  kind: z.literal('authored'),
  /** Agent-id or operator handle — attributable, never anonymous. */
  author: z.string().refine((s) => s.trim().length > 0, {
    message: 'author must be a non-empty, attributable handle',
  }),
  /** ISO-8601 authoring date — a real calendar date (`YYYY-MM-DD`) or a full timestamp. */
  authoredAt: z.string().refine(isIso8601CalendarDate, {
    message: 'authoredAt must be a valid ISO-8601 calendar date (YYYY-MM-DD or a full timestamp)',
  }),
  /** The declared DEFECT the rule targets — the pre-image, not its fix. */
  targetDefect: z.string().refine((s) => s.trim().length > 0, {
    message: 'targetDefect must be a non-empty defect description',
  }),
  /** ≥1 real lc instance the rule claims to catch — ALL train-side (§5). */
  positiveFixtures: z.array(AuthoredFixtureSchema).min(1, {
    message: 'an authored rule must declare ≥1 positive fixture (ADR-112 §3)',
  }),
  /** Declared near-misses the rule must stay silent on (feeds §6 negative controls). */
  negativeFixtures: z.array(AuthoredFixtureSchema).optional(),
});

export type AuthoredProvenanceRecord = z.infer<typeof AuthoredProvenanceRecordSchema>;

/**
 * ADR-112 §3 — `provenance` is a discriminated UNION on `kind`
 * (`mined | authored`), the first multi-producer attribute on a rule
 * (Consequence 3). Built as a `z.union` (NOT `z.discriminatedUnion`) on
 * purpose: the mined wire keeps `kind` OPTIONAL for byte-identical legacy
 * round-trip, which a required-discriminator schema cannot express. The two
 * branches are disjoint on their required fields (`authored` requires
 * `kind:'authored'` + author/targetDefect/fixtures; the mined branch is the
 * only one a legacy `{mergedPr, reviewThread, commitSha}` record satisfies), so
 * the union is unambiguous. `Authored` is listed FIRST so a record carrying
 * `kind:'authored'` never matches the mined branch.
 */
export const ProvenanceRecordSchema = z.union([
  AuthoredProvenanceRecordSchema,
  MinedProvenanceWireSchema,
]);

export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

/**
 * ADR-112 — the canonical reader of a provenance record's producer kind. An
 * absent discriminator (every legacy mined record) reads as `'mined'`. Use this
 * + the guards below instead of touching `.kind` directly, so the
 * absent-⇒-mined default lives in exactly one place (Tenet 20).
 */
export function provenanceKind(p: ProvenanceRecord): 'mined' | 'authored' {
  return p.kind ?? 'mined';
}

/** ADR-112 — type-narrowing guard for the mined branch (mined-only field reads). */
export function isMinedProvenance(p: ProvenanceRecord): p is MinedProvenanceRecord {
  return provenanceKind(p) === 'mined';
}

/** ADR-112 — type-narrowing guard for the authored branch. */
export function isAuthoredProvenance(p: ProvenanceRecord): p is AuthoredProvenanceRecord {
  return p.kind === 'authored';
}

/**
 * mmnto-ai/totem#2183 — the three **peer** legs of the ADR-110 §3 legitimacy
 * bar, mapping 1:1 onto the strategy#666 Tenet-9 three-check so the Gate-1
 * wind-tunnel reads per-rule eligibility off the marker with no translation
 * layer: `provenance` (§3.1) / `positiveControl` (§3.2) / `negativeControl`
 * (§3.3). Controls are pass/fail booleans, **required** when `legitimacy` is
 * present (never defaulted, so an absent control can't silently read as a
 * failed one); the evidence behind each pass lives in the wind-tunnel manifest.
 */
export const LegitimacySchema = z.object({
  provenance: ProvenanceRecordSchema,
  positiveControl: z.boolean(),
  negativeControl: z.boolean(),
});

export type Legitimacy = z.infer<typeof LegitimacySchema>;

// ─── Compiled rule schemas ──────────────────────────

const CompiledRuleBaseSchema = z.object({
  /**
   * The rule's stable identity + wind-tunnel firing key.
   * - MINED / lesson-compiled rules: SHA-256 (first 16 hex chars) of heading + body —
   *   content-derived, detects edits.
   * - AUTHORED rules (ADR-112 §8/§9): carries the PERSISTED, minted `ruleId` (set at
   *   the compile seam from `CompileInputCandidate.ruleId`), NOT a content hash — the
   *   `firingLabelId ← ruleId` id-unification, so a matcher (`dslSource`) edit never
   *   orphans the rule's ground-truth labels / `controls.positive[].targetRuleId`. For
   *   authored rules this is identity, NOT an edit-detector; it may carry a `-N`
   *   collision suffix. (Authored rules are Gate-1 advisory and live only in the cert
   *   corpus, never the product enforcement path that reads this as a content hash.)
   */
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
  /**
   * Lifecycle status. Four values:
   *   - `'active'`         — rule is enforced by `totem lint`/`totem review`.
   *   - `'archived'`       — rule is preserved on disk (telemetry continuity)
   *                          but skipped at lint time. `loadCompiledRules`
   *                          filters these out (`compiler.ts:140`).
   *   - `'untested-against-codebase'` — Stage 4 verifier (mmnto-ai/totem#1682)
   *                          ran against the consumer's codebase but found
   *                          zero matches. The rule's runtime behavior on
   *                          real code is unknown; treated as inert at lint
   *                          time the same way `'archived'` is, but with a
   *                          distinct lifecycle semantic so a subsequent
   *                          compile cycle in a populated repo can re-run
   *                          Stage 4 and promote to `'active'`.
   *   - `'pending-verification'` — pack rule installed via `totem install` in
   *                          the cloud-compile bootstrap path
   *                          (mmnto-ai/totem#1684). Stage 4 verifier has
   *                          never run against the consumer's codebase. Inert
   *                          at lint time exactly like `'archived'` and
   *                          `'untested-against-codebase'`. The first-lint
   *                          promotion interceptor invokes Stage 4 against
   *                          the consumer's codebase on first encounter and
   *                          replaces the status with one of the three
   *                          terminal lifecycle values per Stage4Outcome →
   *                          status mapping (see `first-lint-promote.ts`).
   *                          Lifecycle is one-shot: a rule is `'pending-verification'`
   *                          at most once per `lessonHash` per consumer
   *                          repository (memoized in `verification-outcomes.json`).
   *
   * Distinct from the boolean `unverified` flag below: `unverified` is set
   * by ADR-089 zero-trust default on every LLM-generated rule (post-Layer-3
   * pass); `'untested-against-codebase'` is set by Stage 4 when the
   * verifier's deterministic codebase walk produced no hits. A rule can be
   * `unverified: true` AND `status: 'untested-against-codebase'`
   * simultaneously — they answer different questions (author-trust vs
   * empirical-firing).
   */
  status: z
    .enum(['active', 'archived', 'untested-against-codebase', 'pending-verification'])
    .optional(),
  /**
   * Stage 4 confidence (mmnto-ai/totem#1682). Set to `'high'` when Stage 4's
   * codebase walk found in-scope matches that are structurally equivalent
   * to the rule's `badExample` — the rule fires on real code, and that real
   * code has the exact authored shape, so the rule is doing what the lesson
   * intended. Single-valued enum in T1; future Stage 4 phases may add a
   * `'low'` value (currently no writer; deferred per ticket #1682 Open
   * Question 2). Absent (undefined) means Stage 4 has not assigned a
   * confidence — either the rule was archived, the verifier produced
   * Candidate Debt outcome (forced `severity: 'warning'` carries that
   * signal instead), or Stage 4 has not yet run on this rule.
   */
  confidence: z.enum(['high']).optional(),
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
  /**
   * mmnto-ai/totem#2183 — the ADR-110 §3 legitimacy bar (three peer legs). Set
   * by spine rule-regeneration (strategy#516); **absent on every legacy rule.**
   * When present, `ruleClass` MUST also be present and equal to
   * `deriveRuleClass(rule)` — enforced by the superRefine on
   * `CompiledRuleSchema`. Never written with defaults: absence is the legacy
   * signal and preserves pre-#2183 manifest hashes via canonicalStringify.
   */
  legitimacy: LegitimacySchema.optional(),
  /**
   * mmnto-ai/totem#2183 — the first-class, **derived** enforcement-tier marker
   * that retires the engine-type proxy (#2181). `'hard'` blocks (subject to the
   * unchanged severity gate — error blocks, warning does not); `'advisory'` is
   * printed, non-blocking. Derived from `legitimacy` at mint via
   * `deriveRuleClass`; the reader TRUSTS this frozen stamp and never re-derives
   * at lint-time (ADR-110 §1 mint+validate boundary; Tenet-15
   * verifiable-freezing). Present **iff** `legitimacy` is present; absent ⇒ the
   * reader falls back to the legacy engine-type proxy.
   */
  ruleClass: z.enum(['hard', 'advisory']).optional(),
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

/**
 * mmnto-ai/totem#2183 — derive the enforcement tier from the ADR-110 §3
 * legitimacy bar. Pure + deterministic (Tenet 9). A rule is `'hard'` ONLY when
 * all three legs hold AND the rule is promoted: `legitimacy` present, the
 * owning rule's ADR-089 `unverified` flag is not `true`, and both controls
 * passed. Anything else — no legitimacy, unpromoted, or a failed control — is
 * `'advisory'`. Promotion reads the rule's TOP-LEVEL `unverified` (the single
 * source of truth; #1485 / #1479 already read it), never a nested copy.
 *
 * **Unwired** from `buildCompiledRule` in this slice: the rule-compilation
 * freeze stands, so the sanctioned writer is spine regeneration (strategy#516),
 * which owns the wiring. Exposed as a pure helper for that regenerator and for
 * the consistency superRefine below.
 */
export function deriveRuleClass(rule: {
  legitimacy?: Legitimacy;
  unverified?: boolean;
}): 'hard' | 'advisory' {
  const leg = rule.legitimacy;
  if (!leg) return 'advisory';
  if (rule.unverified === true) return 'advisory';
  if (!leg.positiveControl || !leg.negativeControl) return 'advisory';
  return 'hard';
}

/**
 * mmnto-ai/totem#2183 — the Gate-1 guardrail, enforced structurally at the
 * runtime-parse boundary (ADR-110 §1; codex contract-lens). `legitimacy` and
 * `ruleClass` are present together or absent together, and when present
 * `ruleClass` must equal `deriveRuleClass(rule)`:
 *   - `ruleClass` without `legitimacy` (a forged hard stamp) → parse-fail.
 *   - `legitimacy` without `ruleClass` (a minted rule missing its marker) → parse-fail.
 *   - `ruleClass !== deriveRuleClass(rule)` (inconsistent marker) → parse-fail.
 *   - both absent (a legacy rule) → valid; the reader uses the engine proxy.
 * Because this fires inside `CompiledRuleSchema` (which `loadCompiledRules`
 * parses), `run-compiled-rules.ts` can never observe a forged stamped state —
 * the engine-type proxy is reachable only by un-stamped legacy rules.
 */
function refineLegitimacyRuleClassConsistency(
  data: { legitimacy?: Legitimacy; ruleClass?: 'hard' | 'advisory'; unverified?: boolean },
  ctx: z.RefinementCtx,
): void {
  const hasLegitimacy = data.legitimacy !== undefined;
  const hasRuleClass = data.ruleClass !== undefined;
  if (hasLegitimacy !== hasRuleClass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'legitimacy and ruleClass must be both present or both absent (mmnto-ai/totem#2183)',
      path: [hasRuleClass ? 'legitimacy' : 'ruleClass'],
    });
    return;
  }
  if (hasLegitimacy && hasRuleClass) {
    const expected = deriveRuleClass(data);
    if (data.ruleClass !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ruleClass '${data.ruleClass}' is inconsistent with the derived class '${expected}' (mmnto-ai/totem#2183)`,
        path: ['ruleClass'],
      });
    }
  }
}

export const CompiledRuleSchema = CompiledRuleBaseSchema.superRefine((data, ctx) => {
  refineAstGrepMutualExclusion(data, ctx);
  refineLegitimacyRuleClassConsistency(data, ctx);
});

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
  // `semantic-analysis-required` (mmnto-ai/totem#1634) classifies lessons
  // whose hazard requires semantic or multi-file analysis the compiler
  // cannot perform from a single lesson body: multi-file contracts,
  // closure-body AST analysis, system-parameter-aware scoping, or
  // project-state-conditional semantics. Sibling to `context-required`;
  // both are permanent (structural incapacity, not transient failure).
  'semantic-analysis-required',
  // `self-suppressing-pattern` (mmnto-ai/totem#1664) classifies lessons whose
  // compiled pattern would match a suppression directive (`totem-ignore` /
  // `totem-context`) and self-suppress at runtime — the rule could never
  // fire even if it shipped. Pre-#1664 this rejection was misclassified as
  // `pattern-syntax-invalid` (a retry-pending code), leaving the lesson
  // invisibly stuck in the retry path with no `nonCompilable` ledger entry.
  // Self-suppression is structural, so this code is terminal (NOT in
  // `LEDGER_RETRY_PENDING_CODES`); ledger writes record the audit trail
  // bot reviewers can cite per strategy upstream-feedback item 021.
  'self-suppressing-pattern',
  // `stage4-out-of-scope-match` (mmnto-ai/totem#1682) classifies rules that
  // Stage 4 (Verify-Against-Codebase) auto-archived because the pattern
  // fired on files in the verification baseline — files outside the
  // lesson's `fileGlobs` scope, test files, or fixture directories. The
  // rule is over-broad by definition: it matches legitimate code, not just
  // the authored hazard shape. Stage 4 surfaces the offending paths in the
  // archive's `archivedReason` text (T1 baseline behavior); structured
  // path persistence lands in T3 (mmnto-ai/totem#1684) via
  // `.totem/rule-metrics.json`. Terminal: re-running compile re-evaluates
  // against the current codebase but does not enter the retry path.
  'stage4-out-of-scope-match',
  'legacy-unknown',
]);

export type NonCompilableReasonCode = z.infer<typeof NonCompilableReasonCodeSchema>;

/**
 * Reason codes that represent retry-eligible transient failures, not
 * permanent non-compilability (mmnto-ai/totem#1627). Writing these to
 * `nonCompilable` in `compiled-rules.json` marks a lesson as permanently
 * unfit for a rule, which blocks future compile-worker prompt improvements
 * from ever producing a rule for that lesson.
 *
 * Every member MUST also appear in `NonCompilableReasonCodeSchema`. The
 * corresponding test at `compiler-schema.test.ts` enforces this as a strict
 * subset check. The type annotation below also catches a typo at compile
 * time (a non-member string would fail assignment to
 * `NonCompilableReasonCode`).
 */
export const LEDGER_RETRY_PENDING_CODES: ReadonlySet<NonCompilableReasonCode> = new Set([
  'pattern-syntax-invalid',
  'pattern-zero-match',
  'verify-retry-exhausted',
  'missing-badexample',
  'missing-goodexample',
  'matches-good-example',
]);

/**
 * Policy predicate for the `nonCompilable` ledger in `compiled-rules.json`
 * (mmnto-ai/totem#1627). Returns true for reason codes that represent
 * permanent structural incapacity (conceptual lessons, context guards,
 * semantic-analysis-required hazards, security rejections) and false for
 * retry-eligible transient failures. Callers use the return value to gate
 * `nonCompilableMap.set` so the ledger reflects "lesson genuinely cannot
 * be a rule" rather than "compile attempt produced a bad pattern this
 * time around."
 */
export function shouldWriteToLedger(reasonCode: NonCompilableReasonCode): boolean {
  return !LEDGER_RETRY_PENDING_CODES.has(reasonCode);
}

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
   * LLM-emittable classifier code (mmnto-ai/totem#1598, extended by #1634).
   * Narrower than `NonCompilableReasonCodeSchema` because most reason codes
   * (`verify-retry-exhausted`, `missing-badexample`, `security-rule-rejected`,
   * etc.) are emitted by core routing, not the LLM. Exposing the full enum
   * to the LLM would let it bypass core classification by forging an
   * internal sentinel. This narrow enum lists only the codes the compile
   * prompt is allowed to produce.
   *
   * Only valid when `compilable === false`. Enforced by
   * `refineReasonCodeRequiresNonCompilable` below.
   */
  reasonCode: z.enum(['context-required', 'semantic-analysis-required']).optional(),
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

/**
 * A parsed Tenet-4 shape-2 fail-soft attestation (mmnto-ai/totem#2214,
 * strategy#702/#708). Recognized form: `// totem-context: fail-soft
 * backstop=<name>`, naming the loud systemic backstop that licenses a blanket
 * fail-soft catch. `backstop` is null when the author claimed `fail-soft` but
 * named no backstop — malformed, the lint surfaces a non-blocking WARN. The
 * lint establishes only token-PRESENCE; the backstop's loudness + per-item
 * accounting are verified at review/ADR level, never by this sensor.
 */
export interface FailSoftAttestation {
  kind: 'fail-soft';
  /** The named loud systemic backstop, or null when missing/empty (malformed). */
  backstop: string | null;
}

/** Context passed alongside rule events for Trap Ledger integration. */
export interface RuleEventContext {
  file: string;
  line: number;
  justification?: string;
  /**
   * Populated on `'suppress'` events when the suppressing `// totem-context:`
   * directive parses as a structured fail-soft attestation (mmnto-ai/totem#2214).
   * Carries the typed exemption so downstream ledger writers (#697 Layer-B
   * capability ledger) can audit attested fail-soft boundaries by named backstop.
   */
  attestation?: FailSoftAttestation;
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
