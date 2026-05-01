import { z } from 'zod';

import type { Stage4Outcome } from './stage4-verifier.js';

/**
 * Stage 4 outcome literals serialized into `.totem/verification-outcomes.json`
 * (mmnto-ai/totem#1684, ADR-091 § Bootstrap CI-first). Mirrors the
 * `Stage4Outcome` type from `stage4-verifier.ts` exactly so the storage
 * vocabulary matches the runtime type and we avoid a translation layer that
 * would drift on Stage 4 evolution.
 *
 * The `_OutcomeAlignment` type below enforces the mirror at compile time —
 * if either side adds, drops, or renames a literal, the assertion below
 * fails the build before drift can land in the corpus.
 */
export const Stage4OutcomeStored = z.enum([
  'no-matches',
  'out-of-scope',
  'in-scope-bad-example',
  'candidate-debt',
]);

type _OutcomeAlignment =
  z.infer<typeof Stage4OutcomeStored> extends Stage4Outcome
    ? Stage4Outcome extends z.infer<typeof Stage4OutcomeStored>
      ? true
      : false
    : false;

const _stage4OutcomeAlignment: _OutcomeAlignment = true;
void _stage4OutcomeAlignment;

/**
 * One verification record per pack-installed rule (keyed by `lessonHash` in
 * the file-level record). Persisted across lint runs so subsequent passes
 * skip re-verification when the rule's content hash matches a recorded
 * outcome.
 */
export const VerificationOutcomeEntrySchema = z.object({
  /**
   * `lessonHash` of the rule the outcome was recorded against. Persisted
   * inside the entry as well as serving as the file-level record key so a
   * tampered key (key/value mismatch) can be detected on read.
   */
  ruleHash: z.string().trim().min(1),
  /** ISO-8601 timestamp of when the verifier produced the outcome. */
  verifiedAt: z.string().datetime(),
  /** The terminal Stage 4 outcome that was recorded. */
  outcome: Stage4OutcomeStored,
  /** Repo-relative paths of baseline-scoped files where the rule fired. */
  baselineMatches: z.array(z.string().trim().min(1)).default([]),
  /** Repo-relative paths of in-scope files where the rule fired. */
  inScopeMatches: z.array(z.string().trim().min(1)).default([]),
  /**
   * In-scope match lines that did not match the `badExample` shape — the
   * Candidate Debt evidence carried forward to the `totem doctor` UX
   * surface in mmnto-ai/totem#1685. Empty unless `outcome === 'candidate-debt'`.
   */
  candidateDebtLines: z.array(z.string().trim().min(1)).default([]),
});

/**
 * The on-disk shape of `.totem/verification-outcomes.json`. Wraps the
 * per-rule record in a versioned envelope so structural changes can break
 * the file forward without silent migration: a loader that sees an unknown
 * `version` treats the file as empty and re-verifies, instead of risking a
 * partial parse against a newer schema.
 */
export const VerificationOutcomesFileSchema = z.object({
  version: z.literal(1).default(1),
  outcomes: z.record(z.string(), VerificationOutcomeEntrySchema),
});

export type Stage4OutcomeStoredValue = z.infer<typeof Stage4OutcomeStored>;
export type VerificationOutcomeEntry = z.infer<typeof VerificationOutcomeEntrySchema>;
export type VerificationOutcomesFile = z.infer<typeof VerificationOutcomesFileSchema>;

/**
 * Convenience alias for the in-memory mapping of `lessonHash` to its recorded
 * verification outcome. The file-level wrapper holds the same record under
 * `outcomes`; this alias exists so call sites that operate on the mapping
 * directly (the first-lint promotion interceptor in particular) can carry
 * a focused type without re-derivation. Reserved by mmnto-ai/totem#1684 §
 * "Vocabulary alignment" — `VerificationOutcomesStore` is the canonical name
 * for the in-memory mapping.
 */
export type VerificationOutcomesStore = VerificationOutcomesFile['outcomes'];
