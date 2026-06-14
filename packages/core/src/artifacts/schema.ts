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

/**
 * The schemaVersion WRITTEN by this code. Readers accept any 1.x (F1).
 * 1.1.0 (mmnto-ai/totem#2101): `grounding` gained the optional per-item
 * `bundle`, and `grounding.hash` semantics changed from hash-of-raw-context
 * to hash-of-bundle — the minor is the observable marker for that meaning
 * change; the registry stays empty because the tolerant reader parses both.
 */
export const RUN_ARTIFACT_SCHEMA_VERSION = '1.1.0';

/** The major this reader understands; other majors need a migration entry. */
export const RUN_ARTIFACT_KNOWN_MAJOR = 1;

/**
 * Canonical provenance classes (mmnto-ai/totem#2101, strategy#474 items 1+7).
 * `similarity-only` is the honest class for today's retrieval; the others are
 * reserved for graduation — `structurally-verified` lands via mmnto-ai/totem#344/#375
 * resolvers, `spec-contract`/`compiled-rule` via their respective delivery
 * paths. Schema-level validation stays an open string (extensible without a
 * major — the same reasoning that kept slice 1's `provenanceSummary` free).
 *
 * Fail-safe-down rider (strategy review F2 on mmnto-ai/totem#2101): every consumer
 * (summaries, eval thresholds, future conformance sensing) must treat a
 * non-canonical class string as NOT-upgraded — lowest trust — so an invented
 * class can never confer trust absent code-side graduation. Safe today
 * because classes are builder-emitted constants, never model-supplied; the
 * enforcement test rides mmnto-ai/totem#2103.
 */
export const PROVENANCE_SIMILARITY_ONLY = 'similarity-only';
export const PROVENANCE_STRUCTURALLY_VERIFIED = 'structurally-verified';
export const PROVENANCE_SPEC_CONTRACT = 'spec-contract';
export const PROVENANCE_COMPILED_RULE = 'compiled-rule';
export const PROVENANCE_CLASSES = [
  PROVENANCE_SIMILARITY_ONLY,
  PROVENANCE_STRUCTURALLY_VERIFIED,
  PROVENANCE_SPEC_CONTRACT,
  PROVENANCE_COMPILED_RULE,
] as const;

/**
 * `provenanceSummary` for a bundle with zero items: the run was UNGROUNDED —
 * abstention named epistemically (what the absence means), not mechanically
 * ("empty"). Honest-absent: a degraded run says so in its own record.
 */
export const PROVENANCE_UNGROUNDED = 'ungrounded';

/**
 * Slice-1 admission class for both migrated callers (spec + review): factually
 * completion-only today. #2102 (backend admission contract) changes who
 * supplies the value, not the field. Day-one self-description, same retrofit
 * argument as provenance.
 */
export const ADMISSION_COMPLETION_ONLY = 'completion_only' as const;

/**
 * Elevated admission class (mmnto-ai/totem#2102, strategy#474 slice 3): the
 * backend is admitted to ground itself (agentic retrieval/tool use) rather
 * than complete over caller-delivered context. Requestable only when declared
 * in `orchestrator.capabilities.admissionClasses` — the admission gate in
 * `runOrchestrator` fails loud pre-invoke otherwise.
 */
export const ADMISSION_SELF_GROUNDING_AGENT = 'self_grounding_agent' as const;

/**
 * Closed two-value enum this slice — single source of truth for both
 * `BackendSchema.admissionClass` and the config-side capability declaration
 * (`orchestrator.capabilities.admissionClasses`); a parallel definition is
 * the drift vector the #1429 model-validation review named.
 */
export const ADMISSION_CLASSES = [
  ADMISSION_COMPLETION_ONLY,
  ADMISSION_SELF_GROUNDING_AGENT,
] as const;

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

/**
 * One delivered evidence item (mmnto-ai/totem#2101): identity + content hash
 * + provenance class. NO content bytes — `inputBundle.maskedPrompt` already
 * carries the bytes once; duplicating them bloats every artifact and creates
 * a second DLP surface. Identity fields are required: fabricated or absent
 * identity is the illusion-of-grounding trap the bundle exists to close.
 */
export const GroundingItemSchema = z.object({
  /** Provenance class — open vocabulary, canonical values in {@link PROVENANCE_CLASSES}; consumers fail-safe-down on unknown strings (F2). */
  provenance: z.string().min(1),
  /** Deterministic hash of the delivered snippet content (identity, not bytes). */
  contentHash: z.string().regex(SHA256_HEX, 'contentHash must be a sha256 hex digest'),
  /** Retrieval partition the item entered the prompt under (`spec` | `session_log` | `code` | `lesson`). */
  sourceType: z.string().min(1),
  /** Path relative to the owning repo root — display + structural-resolution identity. */
  filePath: z.string().min(1),
  /** Linked-index name for cross-repo hits; ABSENT = the run's own repo (F1) — post-checks resolve `filePath` against the run's config root when absent. */
  sourceRepo: z.string().min(1).optional(),
});

/**
 * The per-item grounding record. No stored summary/count fields — counts are
 * derived by `summarizeProvenance` (derive-or-couple: a stored mirror can
 * drift from `items`).
 */
export const GroundingBundleSchema = z.object({
  items: z.array(GroundingItemSchema),
});

/** What KIND of grounding the run had — day-one field, never retrofittable. */
export const GroundingSchema = z.object({
  /**
   * Deterministic hash of the grounding surface. From 1.1.0 this is
   * `calculateDeterministicHash(bundle)` — the verifier recomputes it from
   * the artifact surface ALONE (one enumeration, two readers). Slice-1
   * artifacts (no `bundle`) carry their original hash-of-raw-context, which
   * is self-consistent but not recomputable offline.
   */
  hash: z.string().regex(SHA256_HEX, 'grounding.hash must be a sha256 hex digest'),
  /** Derived from the bundle since 1.1.0 (sorted class counts, or `ungrounded`); wholesale string in slice-1 artifacts. */
  provenanceSummary: z.string().min(1),
  /** Per-item provenance record (mmnto-ai/totem#2101). Optional: slice-1 artifacts predate it and cannot be re-classed. */
  bundle: GroundingBundleSchema.optional(),
});

/** Backend identity as RESOLVED (post quota-fallback), not as requested. */
export const BackendSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /** The full provider-qualified string telemetry/cache key on (`provider:model`). */
  qualifiedModel: z.string().min(1),
  admissionClass: z.enum(ADMISSION_CLASSES),
  /** The command tag the run served (`Spec`, `Review`, ...) — the task profile. */
  taskProfile: z.string().min(1),
  temperature: z.number().optional(),
});

/**
 * Caller-declared output contract (mmnto-ai/totem#2102): the citations-or-
 * `VERIFY:` declaration. Callers write; #2103 post-checks read; providers
 * transport, never enforce (Totem is not zero-user — backend cooperation is
 * never assumed, enforcement is caller-side post-invocation). Closed object:
 * extensible by additive optional fields, not an index signature.
 */
export const OutputContractSchema = z.object({
  /** Response claims must carry citations into the delivered grounding. */
  citationsRequired: z.boolean().optional(),
  /** Whether an explicit `VERIFY:` escalation is an acceptable fallback for an uncitable claim. */
  verifyFallback: z.boolean().optional(),
  /** JSON-Schema definition for structured output. */
  schema: z.record(z.unknown()).optional(),
});

/**
 * Caller-declared context policy (mmnto-ai/totem#2102). Advisory this slice —
 * recorded for honesty, enforced by nothing yet — but validated so
 * declared-not-enforced never means accepting nonsense.
 */
export const ContextPolicySchema = z.object({
  /** Advisory context budget. Unit: INPUT TOKENS. */
  budget: z.number().int().positive().optional(),
});

/**
 * Caller identity metadata (mmnto-ai/totem#2102, the #2100 runMetadata
 * target) — recorded verbatim into the artifact.
 */
export const RunMetadataSchema = z.object({
  /** The command/module that issued the run (e.g. `spec`, `review`). */
  caller: z.string().min(1).optional(),
  /** The CLI command identity the run served, when distinct from `caller`. */
  command: z.string().min(1).optional(),
  /**
   * Whether the code-blind grounding guard fired for this run (mmnto-ai/totem#2106):
   * zero code chunks were retrieved, so the prompt carried the suppression
   * directive and the output is degraded/caveated. Recorded so run artifacts
   * (eval fixtures, #2100) are filterable by guard activation without
   * recomputing `code.length === 0` from the grounding bundle.
   */
  codeBlind: z.boolean().optional(),
});

/**
 * The admitted contract group (mmnto-ai/totem#2102). Top-level and optional,
 * NOT inside `inputBundle` — `inputBundle` feeds `inputHash`, and polluting
 * it would break rerun/compare identity for identical prompts. Recorded only
 * when the caller supplied at least one member.
 */
const RunAdmissionSchema = z.object({
  outputContract: OutputContractSchema.optional(),
  contextPolicy: ContextPolicySchema.optional(),
  runMetadata: RunMetadataSchema.optional(),
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
  /** Admitted contract group (mmnto-ai/totem#2102) — additive 1.x optional; slice-1/2 artifacts predate it. */
  admission: RunAdmissionSchema.optional(),
  /**
   * ISO-8601 emission time. EXCLUDED from the content address (identical runs
   * dedup to one artifact regardless of when they ran) — observability only.
   */
  createdAt: z.string(),
});

export type RunArtifact = z.infer<typeof RunArtifactSchema>;
export type InputBundle = z.infer<typeof InputBundleSchema>;
export type GroundingItem = z.infer<typeof GroundingItemSchema>;
export type GroundingBundle = z.infer<typeof GroundingBundleSchema>;
export type OutputContract = z.infer<typeof OutputContractSchema>;
export type ContextPolicy = z.infer<typeof ContextPolicySchema>;
export type RunMetadata = z.infer<typeof RunMetadataSchema>;
/** Inferred from the `BackendSchema` enum — the canonical admission-class union (mmnto-ai/totem#2102). */
export type BackendAdmissionClass = z.infer<typeof BackendSchema>['admissionClass'];
