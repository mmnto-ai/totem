// ─── ADR-111 §8 Gate-1 miner execution ledgers ──────────────────────────────
//
// The five CI-observable ledgers a deterministic zero-LLM harness asserts the
// Falsifying Metric against (run in `totem lint` / the test suite). The schemas
// here are the on-disk contract; the harness (separate module) reads them +
// the split's cover validator to pin each of the 9 FM clauses:
//   emission   → FM(a) provenance / FM(b) unverified / FM(f) seed-blindness
//   drop       → §6 sole disposition for content failure
//   classifier → FM(c) behavioral never compiled
//   split      → FM(d)/(g) cover + FM(e) split-disjointness
//   apiUsage   → FM(h) held-out-fetch count MUST be 0

import { z } from 'zod';

import { MinedProvenanceWireSchema } from '../compiler-schema.js';
import { ClassifierDispositionSchema } from './candidate-rule.js';
import { SplitArtifactSchema } from './split.js';

function nonEmpty(label: string) {
  return z.string().refine((s) => s.trim().length > 0, {
    message: `${label} must be a non-empty reference`,
  });
}

const PrNumber = z.number().int().positive();

/** Routing off the classifier gate: structural → `compile`, behavioral → `rag-only` (never compiled). */
export const RoutingSchema = z.enum(['compile', 'rag-only']);
export type Routing = z.infer<typeof RoutingSchema>;

/**
 * Provenance of a classifier-ledger disposition: a genuine classifier judgment
 * (`classified`) vs a safe-default forced by classifier failure (`error-default`,
 * always `behavioral`/RAG-only) vs an authored rule's INDEPENDENT structural
 * eligibility verdict (`authored-whitelist`, ADR-112 §3 — judged by the static
 * decidable-class whitelist, NOT an LLM classifier; named distinctly so the
 * classifier ledger never claims an LLM classified a human-authored rule —
 * Tenet-20 honesty). Reported in the §8 done-criterion so a flaky classifier's
 * error rate is a NAMED cause of behavioral-heavy output — never conflated with
 * "lc structural signal is sparse" (a valid HONEST-NEGATIVE) or "the classifier
 * mis-routed everything" (Tenet 19). It is NOT a falsifying condition (no FM
 * clause) — a done-criterion diagnostic, like `stage4Confirmed`.
 */
export const DispositionSourceSchema = z.enum([
  'classified',
  'error-default',
  'authored-whitelist',
]);
export type DispositionSource = z.infer<typeof DispositionSourceSchema>;

/**
 * Compile + Stage-4 disposition of a compile-routed (structural) candidate (slice 4).
 * Recorded additively on the classifier ledger so the §8 done-criterion (which reads
 * the LEDGER, not the compiled `rule.status`) can distinguish the verify-stage outcomes
 * rather than collapse them onto the `stage4Confirmed` boolean:
 *   - `confirmed`             — Stage-4 found positive in-scope evidence (active rule).
 *   - `untested-no-matches`   — Stage-4 ran, zero hits (neutral/inconclusive).
 *   - `archived-out-of-scope` — the §4 backstop ACTIVELY rejected a mis-structural
 *                               candidate (fired on the baseline) — a classifier-over-eager
 *                               signal, NOT the same as `no-matches` (Tenet 19, the
 *                               compile-stage twin of `dispositionSource`).
 *   - `compile-rejected`      — the pattern parsed but failed per-engine safety
 *                               validation (e.g. ReDoS); never produced as a rule.
 * Absent on entries the compile stage never touched (behavioral/rag-only, or a
 * classify-only run). NOT a falsifying condition (no FM clause) — a done-criterion
 * diagnostic; the harness only locks its consistency with `stage4Confirmed`.
 */
export const Stage4LedgerOutcomeSchema = z.enum([
  'confirmed',
  'untested-no-matches',
  'archived-out-of-scope',
  'compile-rejected',
]);
export type Stage4LedgerOutcome = z.infer<typeof Stage4LedgerOutcomeSchema>;

/**
 * The SUBSTRATE provenance of a draft / zero-draft drop (slice β, strategy#709,
 * panel OQ-β4): whether the eligible review threads it derived from carried
 * `human`, `bot` (recognized review-finding bot — gemini/CR), or `mixed` comments.
 * `human|bot|mixed` not a binary — a single PR's draft can derive from both. A
 * non-FM Tenet-19 DIAGNOSTIC (like `dispositionSource` / `noDraftCause`): it makes
 * the bot-review-substrate share OBSERVABLE on the §8 emission ledger for this
 * bot-reviewed cert corpus, with NO falsifying-metric weight.
 */
export const DraftSourceKindSchema = z.enum(['human', 'bot', 'mixed']);
export type DraftSourceKind = z.infer<typeof DraftSourceKindSchema>;

// ── 1. Emission ledger ──────────────────────────────────────────────────────

export const EmissionLedgerEntrySchema = z.object({
  candidateRef: nonEmpty('candidateRef'),
  provenance: MinedProvenanceWireSchema,
  classifierDisposition: ClassifierDispositionSchema,
  routing: RoutingSchema,
  classifierLedgerRef: nonEmpty('classifierLedgerRef'),
  unverified: z.literal(true),
  /**
   * Substrate provenance of the draft (slice β, panel OQ-β4) — `human|bot|mixed`,
   * threaded transiently on `DraftCandidate` from the exact extractor input and
   * serialized HERE (NOT on the reused `ProvenanceRecord`/legitimacy stamp, which a
   * diagnostic would pollute). Additive-OPTIONAL so pre-β emission ledgers parse.
   */
  sourceKind: DraftSourceKindSchema.optional(),
});
export type EmissionLedgerEntry = z.infer<typeof EmissionLedgerEntrySchema>;

export const EmissionLedgerSchema = z.object({
  entries: z.array(EmissionLedgerEntrySchema),
  /**
   * Run-level seed-blindness attestation (§7). `false` = no seed class was
   * supplied to any extraction/classification stage; `true` falsifies FM(f).
   */
  extractionInputsAttestation: z.object({ seedClassesProvided: z.boolean() }),
});
export type EmissionLedger = z.infer<typeof EmissionLedgerSchema>;

// ── 2. Drop ledger — the SOLE disposition for any content/provenance failure ──

export const DropReasonCodeSchema = z.enum([
  'unreachable',
  'truncated',
  'unparseable',
  'incomplete-provenance',
  // 'outdated-rejected' (slice γ, strategy#709 — renamed from slice-5a's
  // 'resolved-rejected') — an ELIGIBILITY rejection, semantically distinct from
  // the four above. The content WAS fetched (not `unreachable`), CAN be complete
  // (not `truncated`), and PARSES (not `unparseable`); its provenance is intact
  // (not `incomplete-provenance`). It is dropped because every substantive comment
  // lived on OUTDATED review threads (`isOutdated`): an outdated thread's diff hunk
  // no longer matches HEAD, so its invariant may have been refactored away. NOTE
  // (slice γ): RESOLVED threads are NO LONGER rejected — a resolved thread is the
  // highest-signal legitimacy marker (the Gate-1 cert finding), so it is now
  // ADMITTED; only OUTDATED stays excluded. The §6 eligibility gate (in
  // `runExtractStage`) emptied the eligible-substantive set — every such rejection
  // is ledgered here (never silently pre-filtered by the adapter), satisfying §8.
  'outdated-rejected',
  // 'no-draft' (slice β, strategy β-watch) — the extractor returned ZERO drafts
  // for an otherwise-complete thread. Slice α reused `unparseable` for this, which
  // mislabeled a legitimate model decline (`none-sentinel`) as a parse failure;
  // this code NAMES the no-draft case while the row's `noDraftCause` carries the
  // precise sub-reason (invoke-error / empty-output / none-sentinel / …). Distinct
  // from `unparseable`, which now means ONLY a source-fetch or per-body DSL parse
  // failure.
  'no-draft',
]);
export type DropReasonCode = z.infer<typeof DropReasonCodeSchema>;

/**
 * Why the extractor returned ZERO drafts for an otherwise-complete thread — the
 * extract-stage twin of the classifier's `dispositionSource` (a non-FM Tenet-19
 * diagnostic). A bare `[]` from the `DraftExtractor` port conflates ≥6 distinct
 * causes with opposite fixes; recording WHICH one keeps a parser/format/transient
 * failure from masquerading as "the model judged nothing mintable" (a legitimate
 * decline). Set ONLY on the extractor-produced empty-draft `unparseable` drop —
 * never on a source-`unparseable` fetch failure or a per-body `isUsableDsl` drop.
 *
 * PARSE ORDER is the disjointness contract (evaluate in this order — the adapter
 * sets the first, `parseExtractorOutput` the rest):
 *   - `invoke-error`       — the live LLM invoke rejected (caught in the adapter).
 *   - `empty-output`       — the stripped RAW output was empty (pre-parse).
 *   - `none-sentinel`      — the stripped raw output equals the `NONE` sentinel.
 *   - `unparseable-shape`  — `JSON.parse` threw a `SyntaxError` (malformed JSON).
 *   - `non-array`          — JSON parsed, but not to an array.
 *   - `all-filtered`       — parsed to an array, but zero non-empty string bodies
 *                            survived (`[]`, blanks, non-strings) — NOT `empty-output`.
 *   - `legacy-unknown`     — REPLAY-MIGRATION ONLY: a pre-cause-tag fixture stored a
 *                            bare `string[]` empty row, so the cause was never
 *                            recorded. Never produced by a live parse; signals
 *                            "re-record needed before cause-rate reporting."
 * Not an FM falsifier — a done-criterion diagnostic, like `dispositionSource`.
 */
export const NoDraftCauseSchema = z.enum([
  'invoke-error',
  'empty-output',
  'none-sentinel',
  'unparseable-shape',
  'non-array',
  'all-filtered',
  'legacy-unknown',
]);
export type NoDraftCause = z.infer<typeof NoDraftCauseSchema>;

export const DropLedgerEntrySchema = z.object({
  /**
   * Source PR of the dropped candidate. REQUIRED — the funnel always knows which
   * train PR it is processing (it iterates the train slice), even for an
   * `incomplete-provenance` drop where the review-thread/SHA is missing. An
   * unrecorded source would make the drop uncreditable and open an undetectable
   * FM(i) train-skip gap.
   */
  sourcePr: PrNumber,
  reasonCode: DropReasonCodeSchema,
  detail: z.string().optional(),
  /**
   * The extract-stage NO-DRAFT diagnostic (Tenet-19). Present ONLY on the
   * extractor-produced empty-draft drop (`reasonCode: 'no-draft'`, detail
   * "extractor produced no draft…") — absent on every other drop. Additive-
   * optional so older ledgers (no cause recorded) still parse.
   */
  noDraftCause: NoDraftCauseSchema.optional(),
  /**
   * Substrate provenance (slice β, panel OQ-β4) of the eligible threads on a
   * ZERO-DRAFT (`reasonCode: 'no-draft'`) drop — `human|bot|mixed`, so the §8
   * report can ask "what KIND of substrate did the model decline?". Present only on
   * the no-draft drop; additive-OPTIONAL so other drops + older ledgers parse.
   */
  sourceKind: DraftSourceKindSchema.optional(),
});
export type DropLedgerEntry = z.infer<typeof DropLedgerEntrySchema>;

export const DropLedgerSchema = z.object({ entries: z.array(DropLedgerEntrySchema) });
export type DropLedger = z.infer<typeof DropLedgerSchema>;

// ── 3. Classifier ledger (reported in the done-criterion, §8) ────────────────

export const ClassifierLedgerEntrySchema = z.object({
  /**
   * This classifier-ledger entry's own ref — the JOIN KEY that an emission entry's
   * `classifierLedgerRef` points to (not necessarily the candidate's own
   * `candidateRef`). Slice 1 joins on this ref + checks disposition consistency; a
   * stricter same-candidate identity assertion is deferred to slice 2.
   */
  candidateRef: nonEmpty('candidateRef'),
  disposition: ClassifierDispositionSchema,
  /**
   * Stage-4 Verify-Against-Codebase confirmation — the deterministic backstop.
   * NON-CERTIFYING IN SLICE 1: Stage-4 is wired in slice 4, so the harness does NOT
   * yet require `stage4Confirmed === true` for compile-routed candidates (it checks
   * disposition consistency only). The field is carried now so slice 4 can enforce
   * it without a schema change.
   */
  stage4Confirmed: z.boolean(),
  /**
   * Whether `disposition` is a genuine classifier judgment or a safe-default on
   * classifier failure (always `behavioral`). Present-and-`'classified'` in normal
   * runs; set `'error-default'` on the safe-default path (slice 3). Read by the §8
   * terminal report (slice 5) to keep a flaky-classifier error rate from
   * masquerading as structural-signal sparsity (Tenet 19, panel flag-5). Not an FM
   * condition — a diagnostic, like `stage4Confirmed`.
   */
  dispositionSource: DispositionSourceSchema,
  /**
   * Compile + Stage-4 outcome (slice 4), set by `runCompileStage` on the matched
   * compile-routed entry. OPTIONAL — absent until the compile stage runs (and
   * never set on behavioral/rag-only entries, which are never compiled). When
   * present it MUST be consistent with `stage4Confirmed`: `confirmed` ⟺
   * `stage4Confirmed === true`; the other three outcomes ⟺ `false`. The §8 harness
   * locks that consistency (no new FM clause) — see `Stage4LedgerOutcomeSchema`.
   */
  stage4Outcome: Stage4LedgerOutcomeSchema.optional(),
});
export type ClassifierLedgerEntry = z.infer<typeof ClassifierLedgerEntrySchema>;

export const ClassifierLedgerSchema = z.object({ entries: z.array(ClassifierLedgerEntrySchema) });
export type ClassifierLedger = z.infer<typeof ClassifierLedgerSchema>;

// ── 4. Split ledger — self-contained for the cover check ─────────────────────

export const SplitLedgerSchema = z
  .object({
    split: SplitArtifactSchema,
    /** The frozen corpus = `selectionRule(asOfCommit)` the cover is checked against. */
    corpus: z.array(PrNumber),
    /** PR → merge-commit, for the disjoint-by-merge-commit check (rebuilds the map). */
    corpusMergeCommits: z.array(
      z.object({
        pr: PrNumber,
        // Lowercase 40-hex SHA (same canonical form as asOfCommit / provenance.commitSha)
        // — a generic string would admit case/format bypasses of the collision check.
        mergeCommit: z.string().regex(/^[0-9a-f]{40}$/, {
          message: 'mergeCommit must be a lowercase 40-hex SHA',
        }),
      }),
    ),
  })
  .refine(
    (d) => {
      const covered = new Set(d.corpusMergeCommits.map((e) => e.pr));
      return d.corpus.every((pr) => covered.has(pr));
    },
    {
      // An incomplete map would silently skip merge-commit collision detection for
      // the absent PRs — a straddling revert pair could escape the disjoint-by-
      // merge-commit guard. Require full coverage of the corpus.
      message: 'corpusMergeCommits must cover every corpus PR',
      path: ['corpusMergeCommits'],
    },
  )
  .superRefine((d, ctx) => {
    // Duplicate rows would inflate the cover-base bag while the Set-based checks
    // dedupe them away — reject duplicates in corpus and corpusMergeCommits.pr.
    if (new Set(d.corpus).size !== d.corpus.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'corpus contains duplicate PRs',
        path: ['corpus'],
      });
    }
    const prs = d.corpusMergeCommits.map((e) => e.pr);
    if (new Set(prs).size !== prs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'corpusMergeCommits contains duplicate PRs',
        path: ['corpusMergeCommits'],
      });
    }
  });
export type SplitLedger = z.infer<typeof SplitLedgerSchema>;

// ── 5. API-usage ledger ──────────────────────────────────────────────────────

export const ApiFetchSliceSchema = z.enum(['train', 'heldOut']);
export type ApiFetchSlice = z.infer<typeof ApiFetchSliceSchema>;

export const ApiUsageLedgerEntrySchema = z.object({
  targetPr: PrNumber,
  slice: ApiFetchSliceSchema,
  fetchKind: nonEmpty('fetchKind'),
});
export type ApiUsageLedgerEntry = z.infer<typeof ApiUsageLedgerEntrySchema>;

export const ApiUsageLedgerSchema = z.object({
  entries: z.array(ApiUsageLedgerEntrySchema),
  /** MUST be 0 — any held-out/control content fetch during mining falsifies FM(h). */
  heldOutFetchCount: z.number().int().nonnegative(),
});
export type ApiUsageLedger = z.infer<typeof ApiUsageLedgerSchema>;

// ── Aggregate ────────────────────────────────────────────────────────────────

export const MinerLedgersSchema = z.object({
  emission: EmissionLedgerSchema,
  drop: DropLedgerSchema,
  classifier: ClassifierLedgerSchema,
  split: SplitLedgerSchema,
  apiUsage: ApiUsageLedgerSchema,
});
export type MinerLedgers = z.infer<typeof MinerLedgersSchema>;
