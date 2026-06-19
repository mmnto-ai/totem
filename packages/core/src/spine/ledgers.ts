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

import { ProvenanceRecordSchema } from '../compiler-schema.js';
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

// ── 1. Emission ledger ──────────────────────────────────────────────────────

export const EmissionLedgerEntrySchema = z.object({
  candidateRef: nonEmpty('candidateRef'),
  provenance: ProvenanceRecordSchema,
  classifierDisposition: ClassifierDispositionSchema,
  routing: RoutingSchema,
  classifierLedgerRef: nonEmpty('classifierLedgerRef'),
  unverified: z.literal(true),
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
]);
export type DropReasonCode = z.infer<typeof DropReasonCodeSchema>;

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
});
export type DropLedgerEntry = z.infer<typeof DropLedgerEntrySchema>;

export const DropLedgerSchema = z.object({ entries: z.array(DropLedgerEntrySchema) });
export type DropLedger = z.infer<typeof DropLedgerSchema>;

// ── 3. Classifier ledger (reported in the done-criterion, §8) ────────────────

export const ClassifierLedgerEntrySchema = z.object({
  candidateRef: nonEmpty('candidateRef'),
  disposition: ClassifierDispositionSchema,
  /** Stage-4 Verify-Against-Codebase confirmation — the deterministic backstop. */
  stage4Confirmed: z.boolean(),
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
  );
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
