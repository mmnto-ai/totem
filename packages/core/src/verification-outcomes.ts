import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { canonicalStringify } from './compile-manifest.js';
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

// ─── Persistence (mmnto-ai/totem#1684 T2) ───────────

/**
 * Load the per-rule verification outcomes from a `verification-outcomes.json`
 * file. Returns an empty store when the file is missing, contains malformed
 * JSON, or fails schema validation — the corpus self-heals on the next
 * write. The interceptor that wrote the corrupt file (or a future pass with
 * a refreshed schema) will overwrite it on the next promotion run, so the
 * cache state cannot wedge.
 *
 * Invariant: schema-version mismatch is treated as "no outcomes recorded"
 * rather than attempted migration. A v2 file read by a v1 loader returns
 * an empty store and warns; the next write produces a valid v1 file.
 */
export function readVerificationOutcomes(
  filePath: string,
  onWarn?: (msg: string) => void,
): VerificationOutcomesStore {
  if (!fs.existsSync(filePath)) return {};
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8'); // totem-context: self-healing on transient read errors per Invariant #10 of #1684 — verification-outcomes.json is per-machine cache; corruption is recoverable on next write
  } catch (err) {
    onWarn?.(
      // totem-context: see preceding try — corrupt cache state self-heals; next write overwrites
      `Could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw); // totem-context: self-healing on malformed JSON per Invariant #10 of #1684 — corrupt cache state self-heals; next write overwrites
  } catch (err) {
    onWarn?.(
      // totem-context: see preceding try — corrupt cache state self-heals; next write overwrites
      `Malformed JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}. Treating as empty; next write will overwrite.`,
    );
    return {};
  }
  const result = VerificationOutcomesFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    onWarn?.(
      `Schema validation failed for ${filePath}: ${issues}. Treating as empty; next write will overwrite.`,
    );
    return {};
  }
  // totem-context: defense-in-depth — schema validates each entry's shape but
  // not that the file-level record key matches the entry's stored ruleHash.
  // A tampered or hand-edited file could memoize an outcome under the wrong
  // hash. Drop those entries (with a warn) so memoization never satisfies a
  // mismatched lookup.
  const aligned: VerificationOutcomesStore = {};
  for (const [key, entry] of Object.entries(result.data.outcomes)) {
    if (entry.ruleHash !== key) {
      onWarn?.(
        `Key/hash mismatch in ${filePath}: key=${key}, entry.ruleHash=${entry.ruleHash}. Ignoring entry.`,
      );
      continue;
    }
    aligned[key] = entry;
  }
  return aligned;
}

/**
 * Persist the per-rule verification outcomes to disk via temp-file +
 * atomic rename, so a concurrent CI lint pass that interrupts mid-write
 * leaves the prior valid file intact rather than producing a truncated
 * partial-write that the next loader would reject.
 *
 * Output is canonicalized (recursive object-key sort) before serialization
 * so two lint passes that produce the same outcomes write byte-identical
 * files — Invariant #11 in the design doc, which keeps consumer repos
 * from seeing phantom diffs on every CI run.
 */
export function writeVerificationOutcomes(
  filePath: string,
  outcomes: VerificationOutcomesStore,
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const file: VerificationOutcomesFile = { version: 1, outcomes };
  const json = `${canonicalStringify(file, 2)}\n`;

  // totem-context: per-write unique temp filename so two concurrent lint
  // processes can't clobber each other's in-flight write and trigger a
  // hard rename failure mid-pass (CR mmnto-ai/totem#1787 R1).
  const tmpPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  }
}
