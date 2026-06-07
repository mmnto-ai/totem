/**
 * Run-artifact contract for the grounded single-run ledger (mmnto-ai/totem#2100,
 * strategy#474 slice 1).
 *
 * The artifact is the immutable bridge between the deterministic substrate and
 * non-deterministic LLM execution: a verifiable, offline record of exactly what
 * was sent (post-DLP — the MASKED prompt, never raw) and what came back.
 * Everything downstream (post-checks #2103, panel synthesis #2104, the Phase-2
 * disposition ledger) consumes this shape, so it stays minimal but versioned.
 *
 * Schema-evolution policy (strategy review F1 on the #2100 design, 0253Z
 * dispatch): the reader is version-tolerant WITHIN the major —
 *   - `schemaVersion` validates as `1.x` (never a literal pin),
 *   - every post-1.0.0 field must be additive-optional,
 *   - a MAJOR bump requires a migration entry in the loader before the writer
 *     ships (`loadRunArtifact`'s migration-on-read registry).
 * Hard-reject only unknown majors. Rationale: an append-only ledger whose
 * reader rejects its own history isn't append-only in practice — a literal pin
 * would orphan the accumulated eval-fixture corpus at #2101's first bump.
 *
 * Zod here is a system boundary (persisted JSON read back from disk), per the
 * repo's Zod-at-boundaries-only rule.
 */

import { z } from 'zod';

/** The schemaVersion WRITTEN by this code. Readers accept any 1.x (F1). */
export const RUN_ARTIFACT_SCHEMA_VERSION = '1.0.0';

/** The major this reader understands; other majors need a migration entry. */
export const RUN_ARTIFACT_KNOWN_MAJOR = 1;

/**
 * Slice-1 wholesale provenance summary: the current ad-hoc context assembly is
 * similarity-retrieved, and the bundle must say so from day one (the
 * illusion-of-grounding trap cannot be retrofitted away). #2101 owns per-item
 * provenance classes; this stays a free string so that lands without a major.
 */
export const PROVENANCE_SIMILARITY_ONLY = 'similarity-only';

/**
 * Slice-1 admission class for both migrated callers (spec + review): factually
 * completion-only today. #2102 (backend admission contract) changes who
 * supplies the value, not the field. Day-one self-description, same retrofit
 * argument as provenance.
 */
export const ADMISSION_COMPLETION_ONLY = 'completion_only' as const;

/** sha256 hex content hash (full digest — identity, not display). */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Major-1 semver literal — keep in sync with {@link RUN_ARTIFACT_KNOWN_MAJOR} (CR review on #2114: a literal beats runtime RegExp construction; the major only changes alongside a migration entry anyway). */
const SCHEMA_VERSION_RE = /^1\.\d+\.\d+$/;

/** Accept any 1.x version; reject other majors with the version named (F1). */
const schemaVersionField = z.string().refine(
  (v) => SCHEMA_VERSION_RE.test(v),
  (v) => ({
    message: `unsupported run-artifact schemaVersion "${v}" — this reader understands major ${RUN_ARTIFACT_KNOWN_MAJOR}.x; a new major requires a migration entry in loadRunArtifact`,
  }),
);

/**
 * The assembled prompt inputs, POST-DLP. `maskedPrompt`/`maskedSystemPrompt`
 * are what actually crossed the wire (`maskSecrets` output) — recording the
 * raw prompt would persist secrets to disk.
 */
export const InputBundleSchema = z.object({
  maskedPrompt: z.string(),
  maskedSystemPrompt: z.string().optional(),
  /** Deterministic diff input when the caller ran with a forced scope (#2098). */
  diffScope: z.string().optional(),
  /** The grounded spec contract, when present (review sensing against a spec doc). */
  specContract: z.string().optional(),
});

/** What KIND of grounding the run had — day-one field, never retrofittable. */
export const GroundingSchema = z.object({
  /** Deterministic hash of the grounding context that entered the bundle. */
  hash: z.string().regex(SHA256_HEX, 'grounding.hash must be a sha256 hex digest'),
  /** Wholesale class in slice 1 (`similarity-only`); per-item classes are #2101. */
  provenanceSummary: z.string().min(1),
});

/** Backend identity as RESOLVED (post quota-fallback), not as requested. */
export const BackendSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** The full provider-qualified string telemetry/cache key on (`provider:model`). */
  qualifiedModel: z.string().min(1),
  admissionClass: z.enum(['completion_only', 'self_grounding_agent']),
  /** The command tag the run served (`Spec`, `Review`, ...) — the task profile. */
  taskProfile: z.string().min(1),
  temperature: z.number().optional(),
});

/**
 * Token counts mirror `OrchestratorResult`: `null` means the provider did not
 * report (honest-absent), distinct from the field being absent entirely.
 */
export const RunMetricsSchema = z.object({
  inputTokens: z.number().nullable().optional(),
  outputTokens: z.number().nullable().optional(),
  cacheReadInputTokens: z.number().nullable().optional(),
  durationMs: z.number(),
  finishReason: z.string().optional(),
});

export const RunArtifactSchema = z.object({
  schemaVersion: schemaVersionField,
  inputBundle: InputBundleSchema,
  /** Deterministic hash of `inputBundle` alone — the rerun identity. */
  inputHash: z.string().regex(SHA256_HEX, 'inputHash must be a sha256 hex digest'),
  grounding: GroundingSchema,
  backend: BackendSchema,
  output: z.object({
    content: z.string(),
    metrics: RunMetricsSchema,
  }),
  /**
   * ISO-8601 emission time. EXCLUDED from the content address (identical runs
   * dedup to one artifact regardless of when they ran) — observability only.
   */
  createdAt: z.string(),
});

export type RunArtifact = z.infer<typeof RunArtifactSchema>;
export type InputBundle = z.infer<typeof InputBundleSchema>;
