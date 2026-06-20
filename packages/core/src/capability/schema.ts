// ─── totem-strategy#697 Layer-B cohort-capability ledger — schema ────────────
//
// A claim→resolution prediction ledger; per-agent×task-type "capability" is a
// REGENERABLE CACHE recomputed from an append-only log (Tenet-20 carve-out c, the
// same shape as #670 + the ADR-110 wind-tunnel). Contract canonical on
// totem-strategy#697 (schema c.4755374011; folds 1-5 c.4755799517). The hit-rate is
// NEVER stored mutable — it is recomputed by the regenerator. This module defines the
// append-only claim/resolution schemas + the derived ledger + the deterministic
// `claimId`. It is network/LLM-free.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalStringify } from '../compile-manifest.js';

const nonEmpty = (label: string) =>
  z.string().refine((s) => s.trim().length > 0, { message: `${label} must be a non-empty value` });

/**
 * Task-types (closed-but-append-extensible, #697 axis 5). Only `review-catch` is
 * mined in the first column; the other five are reserved for follow-on columns and
 * carried in the enum so the ledger shape is stable as columns are added.
 */
export const TaskTypeSchema = z.enum([
  'review-catch',
  'bug-localization',
  'diagnostic-harness',
  'diagnostic-screenshot',
  'layout-design',
  'code-impl',
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

/**
 * Resolution outcome (#697). `partial` is its OWN bucket — never half-credited (a
 * `0.5` is an invented score that smuggles quality-synthesis back in, violating FM-b);
 * `unresolved` is the derived absence of an effective resolution by horizon.
 */
export const OutcomeSchema = z.enum(['correct', 'wrong', 'partial', 'unresolved']);
export type Outcome = z.infer<typeof OutcomeSchema>;

/**
 * Closed resolution-source enum (#697 fold 3). There is deliberately NO `llm-judge`
 * member — that makes **FM-b (no LLM-judge in the resolution path) STRUCTURAL**: an
 * LLM-judged resolution is unconstructible at the type/parse boundary, not merely
 * checked. The blind model-diverse head-to-head escape-hatch enters only as a frozen
 * `frozen-label` (a frozen graded result, never a live judge).
 */
export const ResolutionSourceSchema = z.enum([
  'deterministic-event',
  'disposition-thread',
  'frozen-label',
  'operator-tiebreak',
]);
export type ResolutionSource = z.infer<typeof ResolutionSourceSchema>;

/**
 * Layer-B attribution provenance (#697 `{ ref, commitSha }`) — DISTINCT from the spine
 * miner's `ProvenanceRecord` (which keys on a PR number); a capability claim references
 * a thread/primitive `ref` + the commit it was asserted against.
 */
export const CapabilityProvenanceSchema = z.object({
  ref: nonEmpty('provenance.ref'),
  commitSha: z
    .string()
    .regex(/^[0-9a-f]{40}$/, { message: 'commitSha must be a lowercase 40-hex SHA' }),
});
export type CapabilityProvenance = z.infer<typeof CapabilityProvenanceSchema>;

/**
 * An append-only output-time claim. `agentSource` is a STABLE Layer-B actor-id (a
 * cohort seat id or a review-backend catalog id); model/backend identity is NEVER
 * folded into it (kept as separate optional `payload` metadata) so the hit-rate
 * aggregates across model swaps (#697 fold 5; ADR-078 `agent_source` is NOT amended).
 */
export const CapabilityClaimSchema = z.object({
  claimId: nonEmpty('claimId'),
  agentSource: nonEmpty('agentSource'),
  taskType: TaskTypeSchema,
  claimKind: nonEmpty('claimKind'),
  provenance: CapabilityProvenanceSchema,
  /** The source primitive's stable native id — the `claimId` discriminator that survives re-enumeration. */
  nativeKey: nonEmpty('nativeKey'),
  assertedAt: nonEmpty('assertedAt'),
  /** Descriptive metadata (incl. model/backend) — NEVER part of `claimId` (identity ≠ content). */
  payload: z.record(z.unknown()).optional(),
});
export type CapabilityClaim = z.infer<typeof CapabilityClaimSchema>;

/**
 * An append-only ground-truth-time resolution. The log may carry N resolutions per
 * claim (accept → walked back → operator-adjudicated); the regenerator selects exactly
 * one effective terminal per `resolutionHorizon` (#697 fold 2).
 */
export const CapabilityResolutionSchema = z.object({
  resolutionId: nonEmpty('resolutionId'),
  claimId: nonEmpty('claimId'),
  outcome: OutcomeSchema,
  resolutionSource: ResolutionSourceSchema,
  evidenceRef: nonEmpty('evidenceRef'),
  resolvedAt: nonEmpty('resolvedAt'),
  /** Explicit supersession chain — preferred over `resolvedAt` ordering when present. */
  supersedesResolutionId: z.string().optional(),
});
export type CapabilityResolution = z.infer<typeof CapabilityResolutionSchema>;

/**
 * One derived row of the regenerable cache. `hitRate = correctN / decisiveN` where
 * `decisiveN = correctN + wrongN`; `partial` and `unresolved` are BOTH excluded from
 * the rate (reported as their own counts). `hitRate` is `null` when `decisiveN === 0`
 * (no decisive evidence yet — never `0/0` NaN). The full distribution is always present.
 */
export const CapabilityLedgerRowSchema = z.object({
  agentSource: z.string(),
  taskType: TaskTypeSchema,
  correctN: z.number().int().nonnegative(),
  wrongN: z.number().int().nonnegative(),
  partialN: z.number().int().nonnegative(),
  unresolvedN: z.number().int().nonnegative(),
  decisiveN: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1).nullable(),
  lastResolved: z.string().nullable(),
});
export type CapabilityLedgerRow = z.infer<typeof CapabilityLedgerRowSchema>;

export const CapabilityLedgerSchema = z.object({
  /** The asOf bound for "settled" resolutions — the back-mining analog of the frozen corpus. */
  resolutionHorizon: nonEmpty('resolutionHorizon'),
  rows: z.array(CapabilityLedgerRowSchema),
});
export type CapabilityLedger = z.infer<typeof CapabilityLedgerSchema>;

const CLAIM_ID_VERSION = 'capclaim:v1';

/**
 * Deterministic `claimId` (#697 fold 1): a versioned, canonically-serialized digest of
 * the IDENTITY fields only — `payload`/`assertedAt` are excluded so re-back-mining or a
 * payload edit never re-keys the claim and orphans the join (FM-a). `nativeKey` is the
 * primary discriminator (one source primitive can yield N claims); `claimKind` defends
 * against future-task collisions. Key order is irrelevant (canonical serialization).
 */
export function deriveClaimId(input: {
  agentSource: string;
  taskType: TaskType;
  claimKind: string;
  provenanceRef: string;
  commitSha: string;
  nativeKey: string;
}): string {
  const canonical = canonicalStringify({
    agentSource: input.agentSource,
    taskType: input.taskType,
    claimKind: input.claimKind,
    provenanceRef: input.provenanceRef,
    commitSha: input.commitSha,
    nativeKey: input.nativeKey,
  });
  return createHash('sha256').update(`${CLAIM_ID_VERSION}${canonical}`).digest('hex');
}
