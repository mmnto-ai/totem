/**
 * Verdict-artifact contract — the single convergence point both review lanes
 * emit (mmnto-ai/totem#2106, Proposal 302 / 304 R2 local review runner).
 *
 * A verdict artifact is the immutable, content-addressed record of ONE review
 * round over ONE masked diff: the fan of lanes that attempted it (each a
 * terminal {@link RunArtifact} reference, one hop from provenance), the
 * deterministic #2103 post-checks, the normalized findings, the optional #2104
 * panel it assembled, and the derived round/lineage bookkeeping. Everything
 * downstream (the CLI round loop, the pilot ledger's covariate PR-line, the
 * Phase-2 disposition ledger) consumes this shape, so it stays minimal but
 * versioned.
 *
 * ── LANE-BLINDNESS INVARIANT (Proposal 302, DELIBERATE EXCLUSION) ────────────
 * There is NO warm/cold runner-lane discriminator field ANYWHERE in this schema
 * — not at the top level, not on a lane. This exclusion is deliberate: a
 * contract consumer reads the verdict and CANNOT discriminate WHICH runner lane
 * (a warm resident agent vs a cold SDK invocation) produced it. The wording
 * matters (strategy 1a): "consumers cannot discriminate lanes FROM the
 * artifact", NOT "lane identity is unknowable" — `lanes[].runArtifactHash`
 * reaches provenance one hop away and `resolvedBackend` is panel-DIVERSITY data,
 * neither of which is a warm/cold runner discriminator. The absence is enforced
 * by a structural test (snapshots the key set) IN ADDITION to this note.
 *
 * The KEY-set structural test is not enough on its own: a runner class could be
 * smuggled through a laneId VALUE. So `laneId` is additionally constrained to a
 * backend-derived vocabulary — `lane-<index>:<resolvedBackendOrConfiguredLane>`
 * (see {@link LaneIdSchema}) — with a refinement rejecting warm/cold/headless/
 * sdk-runner substrings (strategy-codex G1). Net invariant: a consumer can
 * identify WHICH backend participated (diversity), NEVER whether the producer was
 * warm / cold / headless.
 *
 * Schema-evolution policy mirrors {@link RunArtifactSchema} / the panel artifact
 * (F1): the reader is version-tolerant WITHIN the major — `schemaVersion`
 * validates as `1.x`, every post-1.0.0 field is additive-optional, and a MAJOR
 * bump requires a migration entry in `loadVerdictArtifact` before the writer
 * ships. Hard-reject only unknown majors. Zod is the persisted-JSON boundary
 * (read back from disk), per the repo's Zod-at-boundaries-only rule.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { rethrowAsParseError, TotemError, TotemParseError } from '../errors.js';
import { readJsonSafe } from '../sys/fs.js';
import { calculateDeterministicHash } from './hash.js';
import {
  classifyDiversity,
  PanelDiversitySchema,
  type PersistedPostCheckFinding,
  PersistedPostCheckFindingSchema,
} from './panel.js';

// ─── Schema version (mirrors RunArtifact / Panel F1) ────────────────────────

/** The verdict schemaVersion WRITTEN by this code. Readers accept any 1.x (F1). */
export const VERDICT_ARTIFACT_SCHEMA_VERSION = '1.0.0';

/** The major this reader understands; other majors need a migration entry. */
export const VERDICT_ARTIFACT_KNOWN_MAJOR = 1;

/** Major-1 semver literal — keep in sync with {@link VERDICT_ARTIFACT_KNOWN_MAJOR} (a literal beats runtime RegExp construction; the major only changes alongside a migration entry). */
const VERDICT_SCHEMA_VERSION_RE = /^1\.\d+\.\d+$/;

/** Accept any 1.x version; reject other majors with the version NAMED (F1) —
 * mirrors run-artifact's `schemaVersionField` refine so the rejection error
 * carries the offending value, not just a static string. */
const verdictSchemaVersionField = z.string().refine(
  (v) => VERDICT_SCHEMA_VERSION_RE.test(v),
  (v) => ({
    message: `unsupported verdict-artifact schemaVersion "${v}" — this reader understands major ${VERDICT_ARTIFACT_KNOWN_MAJOR}.x; a new major requires a migration entry in loadVerdictArtifact`,
  }),
);

/** sha256 hex content hash (full digest — identity, not display). */
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Zod guard for a sha256 hex content address (mirrors schema.ts; no bare RegExp.test at the boundary). */
const Sha256HexSchema = z.string().regex(SHA256_HEX, 'must be a sha256 hex digest');

// ─── Diff scope (source-discriminated) ──────────────────────────────────────

/**
 * The four `getDiffForReview` sources. Canonical order matches the design doc.
 */
export const VERDICT_DIFF_SOURCES = [
  'explicit-range',
  'staged',
  'uncommitted',
  'branch-vs-base',
] as const;
export type VerdictDiffSource = (typeof VERDICT_DIFF_SOURCES)[number];

/**
 * The reviewed diff's scope, DISCRIMINATED by `source`. `diffHash` is ALWAYS
 * required (sha256 over the MASKED review-payload bytes the lanes actually
 * reviewed — hash symmetry with the artifact chain, never binds secret-bearing
 * bytes; agy fold 5). The git ref fields are required only where the source
 * makes them meaningful:
 *   - `explicit-range` — `base` AND `head` (the two endpoints).
 *   - `branch-vs-base`  — `base` only (head is the working ref, implicit).
 *   - `staged` / `uncommitted` — NO refs (the index / worktree has none).
 */
export const VerdictDiffScopeSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('explicit-range'),
    diffHash: Sha256HexSchema,
    base: z.string().min(1),
    head: z.string().min(1),
  }),
  z.object({
    source: z.literal('branch-vs-base'),
    diffHash: Sha256HexSchema,
    base: z.string().min(1),
  }),
  z.object({
    source: z.literal('staged'),
    diffHash: Sha256HexSchema,
  }),
  z.object({
    source: z.literal('uncommitted'),
    diffHash: Sha256HexSchema,
  }),
]);
export type VerdictDiffScope = z.infer<typeof VerdictDiffScopeSchema>;

// ─── Lanes (status-discriminated union) ─────────────────────────────────────

/**
 * Typed terminal-failure reasons for a `failed` lane. A failed lane is never
 * handed to `assemblePanelArtifact` and never stamps the cache. NOTE (Prop 302
 * lane-blindness): these classify the FAILURE, never the runner lane — none of
 * them names warm/cold.
 */
export const VERDICT_LANE_FAILURE_REASONS = [
  'invoke-error',
  'quota-exhausted',
  'missing-artifact-emission',
  'config-error',
] as const;
export type VerdictLaneFailureReason = (typeof VERDICT_LANE_FAILURE_REASONS)[number];

/** A `completed` lane's own severity tally (from its extracted structured verdict). */
export const VerdictLaneSummarySchema = z.object({
  critical: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});
export type VerdictLaneSummary = z.infer<typeof VerdictLaneSummarySchema>;

// ─── laneId value-channel vocabulary (Prop 302 G1) ──────────────────────────

/**
 * The EXACT laneId shape — `lane-<index>:<resolvedBackendOrConfiguredLane>`:
 *   - `lane-` literal prefix,
 *   - `<index>` — the lane's zero-based position in the fan (`\d+`),
 *   - `:` separator,
 *   - `<resolvedBackendOrConfiguredLane>` — the resolved backend (`provider:model`,
 *     which itself carries a colon) for a lane that reached a backend, or the
 *     CONFIGURED lane string for a lane that failed before one resolved. Non-empty,
 *     opaque backend/lane text (`.+` — newlines excluded).
 *
 * This is backend-DERIVED vocabulary: a consumer can read the id and identify
 * WHICH backend participated (panel-diversity data), and NOTHING about whether the
 * producer was warm / cold / headless.
 */
export const LANE_ID_SHAPE_RE = /^lane-\d+:.+$/;

/**
 * Runner-class vocabulary that must NEVER appear in a laneId (case-insensitive
 * substrings). The rev-2 structural key test snapshots the top-level + per-lane
 * KEY sets, but a runner class could still be smuggled through a laneId VALUE
 * (`lane-0:warm-resident`); this refinement closes that value channel (strategy-
 * codex G1).
 */
const FORBIDDEN_LANE_RUNNER_VOCAB = /warm|cold|headless|sdk-runner/i;

/**
 * laneId: the backend-derived vocabulary above, PLUS the value-channel
 * lane-blindness refinement (Prop 302 G1). Used by every lane variant so no lane
 * — completed, abstained, or failed — can encode a warm/cold/headless runner class.
 */
export const LaneIdSchema = z
  .string()
  .regex(
    LANE_ID_SHAPE_RE,
    'laneId must have the shape `lane-<index>:<resolvedBackendOrConfiguredLane>` (e.g. `lane-0:anthropic:claude-4`) — backend-derived vocabulary only (Prop 302 G1)',
  )
  .refine(
    (v) => !FORBIDDEN_LANE_RUNNER_VOCAB.test(v),
    'laneId must not encode a warm/cold/headless/sdk-runner runner class — lane-blindness forbids this value-smuggling channel (Prop 302 G1)',
  );

/**
 * One lane's terminal outcome, DISCRIMINATED by `status`. The union makes
 * impossible records unrepresentable (codex fold 2): a `completed` lane STRUCTURALLY
 * requires its `runArtifactHash` (a response-cache hit emits no run artifact and so
 * can never be `completed`); a `failed` lane carries a typed reason and never a
 * `runArtifactHash`. `resolvedBackend` records what actually ran (post quota
 * fallback) and is panel-diversity data — NOT a runner discriminator.
 */
export const VerdictLaneSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('completed'),
    laneId: LaneIdSchema,
    resolvedBackend: z.string().min(1),
    runArtifactHash: Sha256HexSchema,
    verdictSummary: VerdictLaneSummarySchema,
  }),
  z.object({
    status: z.literal('abstained'),
    laneId: LaneIdSchema,
    resolvedBackend: z.string().min(1),
    runArtifactHash: Sha256HexSchema,
    /** Why no usable structured verdict was extractable (invoke happened, output unparseable). */
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal('failed'),
    laneId: LaneIdSchema,
    typedReason: z.enum(VERDICT_LANE_FAILURE_REASONS),
    /**
     * REQUIRED (rev-6 item 3): the configured `provider:model` string the lane was
     * created from. A failed lane can have NO `resolvedBackend` (it failed before a
     * backend resolved — e.g. `config-error` / `missing-artifact-emission`), so the
     * laneId suffix has nothing to bind to unless the configured lane is persisted.
     * The `superRefine` binds `laneId` suffix === `configuredLane` (closing the
     * `lane-0:gemini:completely-invented` tautology): the suffix is no longer free —
     * it must equal this declared field.
     */
    configuredLane: z.string().min(1),
    /**
     * OPTIONAL supplementary provenance: the backend that ACTUALLY ran before the
     * lane failed (present only when a backend resolved — e.g. a quota fallback that
     * then failed). NOT the id binding: after a quota fallback it can legitimately
     * DIFFER from `configuredLane`, so the laneId suffix binds to `configuredLane`
     * (stable at lane creation), never to this field.
     */
    resolvedBackend: z.string().min(1).optional(),
  }),
]);
export type VerdictLane = z.infer<typeof VerdictLaneSchema>;

// ─── Findings (aligned with ShieldFinding — core must not import from cli) ────

/** Severity vocabulary — aligned VERBATIM with cli `ShieldFindingSeveritySchema` (defined here so core stays cli-independent). */
export const VerdictFindingSeveritySchema = z.enum(['CRITICAL', 'WARN', 'INFO']);
export type VerdictFindingSeverity = z.infer<typeof VerdictFindingSeveritySchema>;

/**
 * A normalized finding from the shared review-output extractor. Field names
 * align with cli `ShieldFinding` (`severity` / `confidence` / `message` /
 * `file` / `line`); `confidence` is optional here because not every extracted
 * lane output carries one, but when present it is a 0..1 probability (same
 * bound as ShieldFinding). The diagnostic `message` is NEVER dropped or
 * renamed.
 */
export const VerdictFindingSchema = z.object({
  severity: VerdictFindingSeveritySchema,
  confidence: z.number().min(0).max(1).optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string(),
});
export type VerdictFinding = z.infer<typeof VerdictFindingSchema>;

// ─── Round / lineage ─────────────────────────────────────────────────────────

/**
 * Round bookkeeping (all DERIVED — see the CLI lifecycle). `lineageKey` is the
 * composite hash over the RESOLVED scope selector (see {@link computeLineageKey}
 * — worktree identity + branch + source + the meaningful range selectors), NOT
 * the diff bytes, so legitimate fix rounds still chain; `priorVerdictHash` links
 * the implicit prior round (latest verdict sharing the lineage key) or an
 * explicit `--continues` override; absent at round 0.
 */
export const VerdictRoundSchema = z.object({
  index: z.number().int().nonnegative(),
  priorVerdictHash: Sha256HexSchema.optional(),
  lineageKey: z.string().min(1),
});
export type VerdictRound = z.infer<typeof VerdictRoundSchema>;

// ─── Derived dryness / cache predicates (single source of truth) ─────────────

/**
 * The subset of a verdict the pure predicates read. The persisted boundary AND
 * every CLI caller derive `settled` / cache-eligibility from THESE fields — the
 * stored `settled` boolean is re-derived and checked at parse, never trusted
 * (totem-codex finding 5). `findings` is the exemption-FILTERED union the CLI
 * lands on the artifact; the R2 severity map is pinned `INFO = cosmetic`,
 * `WARN | CRITICAL = actionable`.
 */
export interface VerdictPredicateInput {
  lanes: readonly VerdictLane[];
  findings: readonly VerdictFinding[];
  postChecks: readonly PersistedPostCheckFinding[];
  reviewedState: 'matched' | 'drifted';
}

/** Shared first conjunct: a nonempty fan where every attempted lane completed. */
function everyLaneCompleted(lanes: readonly VerdictLane[]): boolean {
  return lanes.length > 0 && lanes.every((l) => l.status === 'completed');
}

/** A decidable-tier post-check row failed (sensor-tier rows never gate — ADR-109 / #2106). */
function hasDecidablePostCheckFail(postChecks: readonly PersistedPostCheckFinding[]): boolean {
  return postChecks.some((r) => r.tier === 'decidable' && r.verdict === 'fail');
}

/**
 * `settled` — the current-round dryness predicate, PURE over artifact content (no
 * cross-round input, no model output):
 *
 *   settled = (every attempted lane completed)
 *             AND (zero actionable — WARN|CRITICAL — findings)
 *             AND (no decidable-tier post-check row with verdict 'fail')
 *             AND (reviewedState === 'matched')
 *
 * A failed/abstained lane ⇒ fan incomplete ⇒ never settled (a persistent CRITICAL
 * can never settle by lane dropout — agy fold 1, satisfied structurally); drift ⇒
 * the verdict is bound to the pre-fan diff and does NOT cover the current tree ⇒
 * not settled (codex rev-2 fold 1). This export is the SINGLE SOURCE OF TRUTH: the
 * CLI derives its loop-termination signal from it and {@link VerdictArtifactSchema}
 * re-derives + checks the stored `settled` (finding 5) — a crafted lane output
 * cannot flip it (pure function; the exemption filter is the only removal
 * mechanism, upstream of this boundary).
 */
export function deriveSettled(v: VerdictPredicateInput): boolean {
  return (
    everyLaneCompleted(v.lanes) &&
    !v.findings.some((f) => f.severity === 'WARN' || f.severity === 'CRITICAL') &&
    !hasDecidablePostCheckFail(v.postChecks) &&
    v.reviewedState === 'matched'
  );
}

/**
 * Cache eligibility — the DISTINCT, weaker predicate (codex fold 4). Identical to
 * {@link deriveSettled} except it tolerates WARNs (matching today's PASS
 * semantics — the drip class the runner absorbs is WARN-shaped):
 *
 *   cacheEligible = (every attempted lane completed)
 *                   AND (zero CRITICAL findings)
 *                   AND (no decidable-tier post-check row with verdict 'fail')
 *                   AND (reviewedState === 'matched')
 *
 * A degraded fan (any failed/abstained lane) fails the first conjunct and is
 * therefore never cache-eligible; drift blocks the stamp. `settled` (no WARNs) is
 * deliberately STRICTER than cache-eligible (no CRITICALs).
 */
export function deriveCacheEligible(v: VerdictPredicateInput): boolean {
  return (
    everyLaneCompleted(v.lanes) &&
    !v.findings.some((f) => f.severity === 'CRITICAL') &&
    !hasDecidablePostCheckFail(v.postChecks) &&
    v.reviewedState === 'matched'
  );
}

// ─── Verdict artifact ──────────────────────────────────────────────────────

/**
 * The verdict artifact. See the module docstring for the LANE-BLINDNESS
 * invariant (Prop 302): NO warm/cold runner-lane discriminator field exists,
 * deliberately.
 *
 * `superRefine` enforces the cross-field invariants that a hand-edited or
 * builder-buggy record could otherwise violate silently — mirrored counts are
 * NEVER accepted on trust (codex):
 *   - `attemptedLaneCount === lanes.length`; `completedLaneCount === #completed`.
 *   - lanes nonempty, laneIds unique (finding 9c).
 *   - panel ⟺ diversity AND panel ⟺ ≥2 completed lanes, BOTH directions
 *     (finding 9a): a panel is assembled from — and only from — ≥2 usable lanes,
 *     and always emits its diversity summary.
 *   - round-chain shape (finding 9b): `round.index === 0` ⟺ `priorVerdictHash`
 *     absent (round 0 starts a chain; round N>0 links its prior).
 *   - stored `settled === deriveSettled(value)` (finding 5): the persisted
 *     boundary re-derives the dryness predicate, never trusting a fabricated flag.
 */
export const VerdictArtifactSchema = z
  .object({
    schemaVersion: verdictSchemaVersionField,
    /** The reviewed diff's scope + masked-payload hash (source-discriminated). */
    diffScope: VerdictDiffScopeSchema,
    /** Every attempted lane's terminal outcome (status-discriminated union). */
    lanes: z.array(VerdictLaneSchema),
    /** MUST equal `lanes.length` (validated below — never trusted). */
    attemptedLaneCount: z.number().int().nonnegative(),
    /** MUST equal the count of `completed` lanes (validated below — never trusted). */
    completedLaneCount: z.number().int().nonnegative(),
    /** Present IFF a #2104 panel was actually assembled (≥2 completed lanes; guarded below). */
    panelArtifactHash: Sha256HexSchema.optional(),
    /** Deterministic #2103 post-checks — the persisted vocabulary VERBATIM (`ruleName`/`tier`/`verdict`/`message`). */
    postChecks: z.array(PersistedPostCheckFindingSchema),
    /** Normalized findings from the shared extractor (exemption-filtered by the CLI before it lands here). */
    findings: z.array(VerdictFindingSchema),
    /** A SINGLE top-level panel-diversity summary (classifyDiversity output) — present only with a panel; NEVER mirrored per finding. */
    diversity: PanelDiversitySchema.optional(),
    round: VerdictRoundSchema,
    /**
     * Post-fan tree compare against the PRE-fan content hash (codex rev-2 fold 1):
     * `'matched'` when the tracked-source tree is byte-identical before and after
     * the fan, `'drifted'` when it changed mid-fan. A DERIVED, non-sentinel field
     * (the two hash domains stay separate — this records the OUTCOME of the compare,
     * not the content hash itself). Drift forces `settled=false` and blocks the
     * cache stamp: the verdict is bound to the pre-fan diff, so a dry fan over a
     * mutated tree does NOT cover the current tree and must not settle the loop.
     */
    reviewedState: z.enum(['matched', 'drifted']),
    /** Current-round dryness predicate (see the CLI lifecycle) — pure over artifact content. */
    settled: z.boolean(),
    /**
     * ISO-8601 emission time — a VALIDATED datetime (rev-5 item 8): a malformed
     * `createdAt` is rejected at the persisted boundary rather than trusted.
     * EXCLUDED from the content address (identical rounds dedup to one artifact
     * regardless of when they ran) — observability only, and it is never a
     * lineage tie-breaker (see {@link findLatestVerdictForLineage}). See
     * {@link computeVerdictArtifactContentHash}.
     */
    createdAt: z.string().datetime(),
  })
  .superRefine((a, ctx) => {
    if (a.attemptedLaneCount !== a.lanes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attemptedLaneCount'],
        message: `attemptedLaneCount (${a.attemptedLaneCount}) must equal lanes.length (${a.lanes.length}) — counts are never mirrored on trust`,
      });
    }
    const completed = a.lanes.filter((l) => l.status === 'completed').length;
    if (a.completedLaneCount !== completed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedLaneCount'],
        message: `completedLaneCount (${a.completedLaneCount}) must equal the number of completed lanes (${completed}) — counts are never mirrored on trust`,
      });
    }

    // ── Finding 9c: lanes nonempty, laneIds unique ──
    if (a.lanes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lanes'],
        message:
          'lanes must be nonempty — a verdict records at least the lane(s) attempted (even a total-failure fan lists its failed lanes)',
      });
    }
    const laneIds = a.lanes.map((l) => l.laneId);
    const duplicateLaneIds = [...new Set(laneIds.filter((id, i) => laneIds.indexOf(id) !== i))];
    if (duplicateLaneIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lanes'],
        message: `duplicate laneId(s) [${duplicateLaneIds.join(', ')}] — each lane needs a unique id`,
      });
    }

    // ── Finding 9a: panel ⟺ diversity AND panel ⟺ ≥2 completed lanes (both directions) ──
    const hasPanel = a.panelArtifactHash !== undefined;
    const hasDiversity = a.diversity !== undefined;
    if (hasPanel !== hasDiversity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasPanel ? 'diversity' : 'panelArtifactHash'],
        message:
          'panelArtifactHash and diversity must be present together — a panel always emits its diversity summary, and a diversity summary is meaningful only alongside a panel',
      });
    }
    if (hasPanel && completed < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panelArtifactHash'],
        message: `panelArtifactHash present requires at least 2 completed lanes (found ${completed}) — a panel is assembled only from usable lanes`,
      });
    }
    if (!hasPanel && completed >= 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panelArtifactHash'],
        message: `${completed} completed lanes require a panel (panelArtifactHash + diversity) — a panel is assembled from ALL usable lanes (≥2)`,
      });
    }

    // ── Finding 9b: round.index === 0 ⟺ priorVerdictHash absent ──
    const isRoundZero = a.round.index === 0;
    const hasPrior = a.round.priorVerdictHash !== undefined;
    if (isRoundZero && hasPrior) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['round', 'priorVerdictHash'],
        message:
          'round 0 must NOT carry priorVerdictHash — round 0 starts a lineage chain (a divergence forks back to round 0)',
      });
    }
    if (!isRoundZero && !hasPrior) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['round', 'priorVerdictHash'],
        message: `round ${a.round.index} (>0) requires priorVerdictHash linking the prior round in the chain`,
      });
    }

    // ── Finding 5: the persisted boundary re-derives `settled`, never trusts it ──
    const derivedSettled = deriveSettled(a);
    if (a.settled !== derivedSettled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settled'],
        message: `settled (${a.settled}) must equal the re-derived current-round dryness predicate (${derivedSettled}) — settled is derived at the persisted boundary, never trusted (finding 5)`,
      });
    }

    // ── rev-5 item 6 + rev-6 item 3: structural laneId validation (array-index + binding) ──
    // {@link LaneIdSchema} enforces the SHAPE + the runner-vocab blacklist per-value;
    // the CROSS-FIELD invariants need the lane's array position and sibling fields, so
    // they live here. For every lane the id must be exactly `lane-<i>:<suffix>` where
    // `<i>` matches the array index; the suffix binds to the lane's OWN identity field —
    // `resolvedBackend` for a completed/abstained lane (the backend that ran), and
    // `configuredLane` for a failed lane (the configured provider:model, present even
    // pre-resolution — rev-6 item 3, closing the free-suffix tautology). A failed lane's
    // optional `resolvedBackend` is supplementary provenance, NOT the binding (a quota
    // fallback can make it differ from configuredLane). The blacklist stays defense-in-depth.
    a.lanes.forEach((lane, i) => {
      const expectedPrefix = `lane-${i}:`;
      if (!lane.laneId.startsWith(expectedPrefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lanes', i, 'laneId'],
          message: `laneId "${lane.laneId}" must begin with "${expectedPrefix}" — the index must match the lane's array position (${i})`,
        });
        return; // suffix checks are meaningless once the prefix is wrong
      }
      const suffix = lane.laneId.slice(expectedPrefix.length);
      if (lane.status === 'completed' || lane.status === 'abstained') {
        if (suffix !== lane.resolvedBackend) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lanes', i, 'laneId'],
            message: `laneId suffix "${suffix}" must equal resolvedBackend "${lane.resolvedBackend}" for a ${lane.status} lane`,
          });
        }
      } else if (suffix !== lane.configuredLane) {
        // A failed lane's suffix binds to the CONFIGURED lane (rev-6 item 3): the lane
        // may have failed before ANY backend resolved, so the configured provider:model
        // is the only stable identity, and the id must not be a free-floating value.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lanes', i, 'laneId'],
          message: `failed laneId suffix "${suffix}" must equal configuredLane "${lane.configuredLane}" — a failed lane's id binds to the configured provider:model (rev-6 item 3)`,
        });
      }
    });

    // ── rev-5 item 7 + rev-6 item 2: FULLY re-derive the diversity summary ──
    // A present diversity summary must be RE-DERIVABLE from the completed lanes' resolved
    // backends via the SAME {@link classifyDiversity} logic the panel uses (single source
    // of truth). rev-6 item 2 compares the WHOLE classifyDiversity result — not just the
    // provider SET + class — so a forged `distinctProviders` / `unrecognizedProviders` /
    // `diversityConfidence` over same-vendor lanes can no longer slip through:
    //   - `providers` as a sorted MULTISET (order ignored — the verdict's completed lanes
    //     are in configured order while the panel's providers[] is laneId-sorted — but
    //     DUPLICATES preserved: two same-vendor lanes are two entries, not a collapsed set);
    //   - `distinctProviders`, `class`, `unrecognizedProviders`, `diversityConfidence`
    //     each re-derived and required to match (all pure functions of the multiset).
    if (a.diversity !== undefined) {
      const completedProviders = a.lanes
        .filter((l): l is Extract<VerdictLane, { status: 'completed' }> => l.status === 'completed')
        .map((l) => providerFamilyOf(l.resolvedBackend));
      const derived = classifyDiversity(completedProviders);
      const storedProviders = [...a.diversity.providers].sort();
      const derivedProviders = [...derived.providers].sort();
      const providersEqual =
        storedProviders.length === derivedProviders.length &&
        storedProviders.every((p, i) => p === derivedProviders[i]);
      if (!providersEqual) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diversity', 'providers'],
          message: `diversity providers multiset [${storedProviders.join(', ')}] must equal the multiset derived from the completed lanes' backends [${derivedProviders.join(', ')}] — the summary is re-derived at the persisted boundary, never trusted`,
        });
      }
      if (a.diversity.distinctProviders !== derived.distinctProviders) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diversity', 'distinctProviders'],
          message: `diversity.distinctProviders (${a.diversity.distinctProviders}) must equal the value derived from the completed lanes' backends (${derived.distinctProviders})`,
        });
      }
      if (a.diversity.class !== derived.class) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diversity', 'class'],
          message: `diversity.class "${a.diversity.class}" must equal the class derived from the completed lanes' backends ("${derived.class}")`,
        });
      }
      const storedUnrecognized = a.diversity.unrecognizedProviders;
      const unrecognizedEqual =
        storedUnrecognized.length === derived.unrecognizedProviders.length &&
        storedUnrecognized.every((p, i) => p === derived.unrecognizedProviders[i]);
      if (!unrecognizedEqual) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diversity', 'unrecognizedProviders'],
          message: `diversity.unrecognizedProviders [${storedUnrecognized.join(', ')}] must equal the set derived from the completed lanes' backends [${derived.unrecognizedProviders.join(', ')}]`,
        });
      }
      if (a.diversity.diversityConfidence !== derived.diversityConfidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['diversity', 'diversityConfidence'],
          message: `diversity.diversityConfidence "${a.diversity.diversityConfidence}" must equal the value derived from the completed lanes' backends ("${derived.diversityConfidence}")`,
        });
      }
    }
  });
export type VerdictArtifact = z.infer<typeof VerdictArtifactSchema>;

/**
 * The provider FAMILY of a resolved backend (`provider:model` → `provider`) — the
 * unit {@link classifyDiversity} clusters on (rev-5 item 7). The panel derives its
 * diversity from each lane's `backend.provider`; a completed verdict lane records
 * `resolvedBackend` as the `qualifiedModel` (`provider:model`), so the family is the
 * segment before the FIRST colon (`provider` never contains a colon). A bare string
 * with no colon is returned whole (defensive — fan lanes are always `provider:model`).
 */
function providerFamilyOf(resolvedBackend: string): string {
  const idx = resolvedBackend.indexOf(':');
  return idx === -1 ? resolvedBackend : resolvedBackend.slice(0, idx);
}

// ─── Lineage key ──────────────────────────────────────────────────────────

/**
 * The round-chain lineage key is composite over the RESOLVED scope selector (agy
 * fold 3; codex rev-2 fold 2) — NOT the source enum alone. The selector fields
 * describe the *lineage*, never the changing diff bytes, so legitimate fix rounds
 * still chain. Per-source contribution (the CLI resolver populates only the fields
 * a source makes meaningful):
 *   - `repoIdentity` — the stable worktree identity (absolute resolved
 *     `git rev-parse --show-toplevel`), ALWAYS present.
 *   - `branch` — the current branch (or the `DETACHED:<sha>` marker), ALWAYS present.
 *   - `source` — the `getDiffForReview` source, ALWAYS present.
 *   - `explicit-range` — normalized `base` + `head` (the two endpoints).
 *   - `branch-vs-base` — resolved `base` + `mergeBase`.
 *   - `staged` / `uncommitted` — NO range fields (worktree identity + branch +
 *     source carry the lineage).
 */
/** Fields every lineage-key variant carries, regardless of source. */
interface LineageKeyCommon {
  /** Stable worktree identity — the absolute resolved `git rev-parse --show-toplevel`. */
  repoIdentity: string;
  /** The current branch, or the `DETACHED:<sha>` marker. */
  branch: string;
  /**
   * The raw CLI selector FORM (finding 10) — accepted on EVERY variant now so the
   * key shape is stable before the CLI populates it. It distinguishes selectors
   * that resolve to the same refs but describe different lineages, e.g. `--diff main`
   * (working-tree mode) vs `main..HEAD` (range mode). Absent today (⇒ hashed as
   * `null`); when the CLI agent supplies it (finding 10) the key already accounts
   * for it — no further domain-tag bump needed.
   */
  selectorForm?: string;
}

/**
 * `computeLineageKey` input, SOURCE-DISCRIMINATED (totem-codex finding 9d): each
 * variant carries ONLY the range fields its source makes meaningful, so an
 * impossible record (e.g. a `staged` scope with a `head` endpoint) is
 * unrepresentable.
 *   - `explicit-range` — `base` + `head` (the two endpoints).
 *   - `branch-vs-base` — `base` (resolved base ref) + `mergeBase` (resolved sha).
 *   - `staged` / `uncommitted` — NO range fields; repoIdentity + branch + source
 *     (+ optional selectorForm) carry the lineage (the index/worktree has no endpoint).
 */
export type LineageKeyInput =
  | (LineageKeyCommon & { source: 'explicit-range'; base: string; head: string })
  | (LineageKeyCommon & { source: 'branch-vs-base'; base: string; mergeBase: string })
  | (LineageKeyCommon & { source: 'staged' })
  | (LineageKeyCommon & { source: 'uncommitted' });

/**
 * The composite round-chain lineage key: a domain-tagged sha256 over the resolved
 * scope selector (agy fold 3; codex rev-2 fold 2). Two branches sharing `base=main`
 * can NEVER cross-link because `branch` participates, and two DIFFERENT explicit
 * ranges on one branch + merge-base cannot cross-link because `base`/`head`
 * participate.
 *
 * The domain tag is `verdict-lineage/3` — bumped from `/2` because the selector
 * shape changed (source-discriminated input + `selectorForm`), so keys under the
 * two tags are deliberately incompatible.
 *
 * Only the fields VALID for the discriminated `source` participate (the switch
 * reads them per-variant), pinning the others to `null`. The selector is hashed as
 * a canonicalized (recursively key-sorted) JSON object with the fixed domain tag,
 * so there is NO delimiter-injection ambiguity — `branch='a', mergeBase='b|c'` and
 * `branch='a|b', mergeBase='c'` serialize to distinct JSON and therefore distinct
 * keys, which a naive `join('|')` would collide. A `null` hole (a source that omits
 * a field) can never collide with an empty string a source supplies for it.
 */
export function computeLineageKey(input: LineageKeyInput): string {
  let base: string | null = null;
  let head: string | null = null;
  let mergeBase: string | null = null;
  switch (input.source) {
    case 'explicit-range':
      base = input.base;
      head = input.head;
      break;
    case 'branch-vs-base':
      base = input.base;
      mergeBase = input.mergeBase;
      break;
    case 'staged':
    case 'uncommitted':
      break;
  }
  return calculateDeterministicHash({
    domain: 'verdict-lineage/3',
    repoIdentity: input.repoIdentity,
    branch: input.branch,
    source: input.source,
    selectorForm: input.selectorForm ?? null,
    base,
    head,
    mergeBase,
  });
}

// ─── Content-addressed storage (mirrors storage.ts / panel.ts) ──────────────

/** Storage layout segments under the totem dir (exact layout = impl call). */
const VERDICTS_DIR_SEGMENTS = ['artifacts', 'verdicts'] as const;

/** Matches a stored verdict file name and captures its content-address stem. */
const VERDICT_FILE_RE = /^([0-9a-f]{64})\.json$/;

/**
 * Migration-on-read registry (F1). Keyed by MAJOR; each entry lifts a parsed
 * raw object of that major to the current shape. EMPTY at 1.0.0 by design — the
 * policy requires a major bump to land its migration entry here BEFORE the
 * writer ships, so empty is the honest statement that no other major exists.
 * Each entry MUST return current-schema output; the loader re-validates via
 * parse() before returning.
 */
const MIGRATIONS: ReadonlyMap<number, (raw: unknown) => VerdictArtifact> = new Map();

/** Absolute verdicts directory for a given absolute totem dir. */
export function verdictsDir(totemDirAbs: string): string {
  return path.join(totemDirAbs, ...VERDICTS_DIR_SEGMENTS);
}

/**
 * Content address of a verdict: deterministic hash over everything EXCEPT
 * `createdAt` (observability, not identity). Identical rounds dedup to one
 * artifact regardless of when they ran.
 */
export function computeVerdictArtifactContentHash(artifact: VerdictArtifact): string {
  const { createdAt: _excluded, ...identity } = artifact;
  return calculateDeterministicHash(identity);
}

/**
 * Content address over the RAW parsed JSON payload with ONLY `createdAt` excluded
 * (rev-5 item 5) — the canonical identity used for load verification. Unlike
 * {@link computeVerdictArtifactContentHash} (which hashes the Zod-normalized shape),
 * this hashes exactly the bytes on disk minus `createdAt`, so an unknown-key tamper
 * is caught and a forward-minor additive field verifies. `calculateDeterministicHash`
 * canonicalizes (recursive key sort), so for a same-version artifact with no unknown
 * keys the two functions agree.
 */
function computeRawVerdictContentHash(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    // Unreachable after a successful parse (the schema requires an object), but stay
    // defensive rather than destructure a non-object.
    return calculateDeterministicHash(raw);
  }
  const { createdAt: _excluded, ...identity } = raw as Record<string, unknown>;
  return calculateDeterministicHash(identity);
}

/**
 * A loaded verdict paired with its VERIFIED content address (the filename stem = the
 * raw-payload hash). The address SURVIVES the tolerant Zod parse (rev-6 item 1): a
 * forward-minor artifact whose writer addressed a raw payload with an additive field
 * THIS reader strips keeps its on-disk address here, so no downstream consumer
 * (covariate line, lineage tie-break, round linkage) recomputes a DIVERGING identity
 * over the normalized shape — the covariate line would otherwise advertise a hash with
 * no file, and round linkage would point at a nonexistent prior. Every load/scan entry
 * point returns this pair so the stored address is the single identity every consumer uses.
 */
export interface VerdictWithAddress {
  artifact: VerdictArtifact;
  /** The verified content address = the filename stem (raw-payload hash, `createdAt` excluded). */
  contentHash: string;
}

/**
 * Render the machine-readable covariate line — the CORE-OWNED signal every caller
 * (CLI print, headless, `/review-reply`) emits identically so the skill stays pure
 * transport (strategy-codex G4; resolves finding 14). Format, EXACTLY:
 *
 *   `local-lane: <hash8> round=<n> settled=<true|false> lanes=<completed>/<attempted>`
 *
 * where `<hash8>` is the first 8 hex of the artifact's STORED content address. The
 * signature takes a {@link VerdictWithAddress} (rev-6 item 1) so the rendered `<hash8>`
 * is the VERIFIED on-disk address that survived the tolerant parse — NOT a recompute
 * over the Zod-stripped shape, which would diverge for a forward-minor artifact and
 * advertise a hash with no backing file. A caller with a freshly-assembled verdict
 * pairs it with the address `saveVerdictArtifact` returned.
 *
 * @remarks Covariate line format v1 — do NOT alter without a spec amendment (the
 * pilot ledger joins on this grep-able line; the format is contract, versioned with
 * the `review-loop` skill).
 */
export function renderCovariateLine(verdict: VerdictWithAddress): string {
  const hash8 = verdict.contentHash.slice(0, 8);
  const a = verdict.artifact;
  return `local-lane: ${hash8} round=${a.round.index} settled=${a.settled} lanes=${a.completedLaneCount}/${a.attemptedLaneCount}`;
}

export interface SaveVerdictArtifactResult {
  /** The content address (= filename stem). */
  hash: string;
  /** Absolute path of the stored artifact. */
  path: string;
  /** True when an identical logical verdict was already recorded (no write happened). */
  existed: boolean;
}

/**
 * Persist a verdict at its content address, write-if-absent (`wx` create-
 * exclusive). Validates on the way OUT so a writer bug never poisons the ledger
 * with a record the reader would reject.
 *
 * EEXIST is LOGICAL-IDENTITY DEDUP (`createdAt` excluded from the address; codex
 * fold 8 / agy fold 4): the existing record is loaded and its content hash
 * recomputed. If it matches this address (equal MODULO `createdAt`), the stored
 * record IS this save's outcome — first-write-wins, dedup return. If the record
 * at this address recomputes to a DIFFERENT hash, its bytes disagree with the
 * content address — a hard identity violation (a corrupted/tampered record or a
 * sha256 collision), never silently accepted.
 */
export function saveVerdictArtifact(
  totemDirAbs: string,
  artifact: VerdictArtifact,
): SaveVerdictArtifactResult {
  const validated = VerdictArtifactSchema.parse(artifact);
  // Save/load address SYMMETRY (rev-6 item 1): the hash is computed over the SAME
  // object that gets serialized (`validated`, no unknown keys), and load re-hashes the
  // raw on-disk bytes minus `createdAt` — so a record written here always verifies back
  // to THIS `hash`. The returned `hash` IS the raw address on disk; callers pairing a
  // freshly-saved verdict with its address use it directly (never a re-derivation).
  const hash = computeVerdictArtifactContentHash(validated);
  const dir = verdictsDir(totemDirAbs);
  const filePath = path.join(dir, `${hash}.json`);

  fs.mkdirSync(dir, { recursive: true });
  try {
    // `wx` = atomic create-exclusive: the write fails EEXIST if a record already
    // occupies this address, so the identity-verification path below always sees
    // the durable record (no TOCTOU between a check and the write).
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), {
      encoding: 'utf-8',
      mode: 0o600, // matches run/panel storage — verdicts reach masked prompt content one hop away
      flag: 'wx',
    });
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      // Logical-identity dedup (codex fold 8 / agy fold 4). loadVerdictArtifact now
      // VERIFIES the incumbent's content address (finding 4): a successful load
      // proves the stored record hashes back to THIS address — which equals our
      // artifact's content address — i.e. the SAME logical verdict modulo createdAt
      // (first-write-wins). A DIFFERING or corrupt record cannot occupy this address
      // without failing that verification, so the verified load itself surfaces the
      // identity violation loud (its own hard error) — nothing is swallowed here.
      loadVerdictArtifact(totemDirAbs, hash);
      return { hash, path: filePath, existed: true };
    }
    throw err;
  }
  return { hash, path: filePath, existed: false };
}

/**
 * Load + validate a verdict by content address, returning the artifact WITH its
 * verified content address (rev-6 item 1 — {@link VerdictWithAddress}). Throws
 * {@link TotemParseError} on a missing file, corrupt JSON, schema violation, or an
 * unknown major with no migration entry, and {@link TotemError} (`DATABASE_MISMATCH`)
 * when the stored bytes do not hash back to their filename address (finding 4) — loud,
 * never a silent partial (Tenet 4).
 *
 * Order (rev-6 item 5): the RAW stored address is verified FIRST — the content-address
 * guarantee is over the on-disk bytes (minus `createdAt`), MAJOR-agnostic and
 * migration-independent, so a mis-addressed / tampered file fails before it is
 * transformed. Only THEN is any migration applied and its output validated against the
 * current schema (a separate concern — migration correctness, not address integrity).
 * The returned `contentHash` is always this verified filename address.
 */
export function loadVerdictArtifact(totemDirAbs: string, hash: string): VerdictWithAddress {
  if (!Sha256HexSchema.safeParse(hash).success) {
    throw new TotemParseError(
      `Invalid verdict-artifact id "${hash}" — expected a 64-char sha256 hex content address.`,
      'Pass the hash exactly as reported at emission (or from the artifacts/verdicts/ filename).',
    );
  }
  const filePath = path.join(verdictsDir(totemDirAbs), `${hash}.json`);
  const raw = readJsonSafe(filePath);

  // ── rev-6 item 5 + rev-5 item 5: verify the RAW stored address BEFORE any migration ──
  // Content-address verification hashes the RAW logical payload (`createdAt` excluded),
  // NOT a Zod-normalized shape. Hashing the normalized output would be unsound TWO ways:
  // (a) an unknown-key TAMPER survives — Zod strips the injected key before the recompute,
  // so a normalized hash still matches the address; (b) a forward-minor artifact is WRONGLY
  // rejected — its writer addressed a raw payload including an additive field this reader
  // strips, so a normalized recompute diverges. The raw payload IS the canonical identity,
  // it is major-AGNOSTIC (whatever major wrote the file addressed its own raw bytes), so
  // this check precedes migration: a mis-addressed / hand-edited / collided record is
  // rejected LOUD before we transform it (finding 4).
  const verificationHash = computeRawVerdictContentHash(raw);
  if (verificationHash !== hash) {
    throw new TotemError(
      'DATABASE_MISMATCH',
      `Verdict artifact at ${filePath} fails content-address verification: its recomputed content hash ${verificationHash} does not match the filename address ${hash} (modulo createdAt).`,
      'This should be unreachable in a content-addressed store. Investigate a mis-addressed copy, a hand-edited/corrupted verdict file, or a hash collision, then re-emit the round.',
    );
  }

  // ── THEN migrate (if a known older major) and validate the migrated/parsed output
  // SEPARATELY against the current schema (migration correctness ≠ address integrity) ──
  const major = readMajor(raw);
  const migrate = major !== undefined ? MIGRATIONS.get(major) : undefined;
  if (migrate !== undefined) {
    // Re-validate migrated output against the CURRENT schema before returning: a
    // migration's contract is to PRODUCE the current shape, so a migration bug must
    // fail loud here — never return it unvalidated. The stored file remains addressed
    // over its (verified) raw bytes, so `contentHash` stays the filename address.
    return { artifact: VerdictArtifactSchema.parse(migrate(raw)), contentHash: hash };
  }
  // `.safeParse` (not try/catch) so the fail-loud rethrow is an explicit statement,
  // never swallowed control flow: rethrowAsParseError returns `never` (always throws),
  // normalizing ZodError to the module's TotemParseError load contract and preserving
  // cause. No catch clause ⇒ no bare-swallow surface. The tolerant Zod parse governs
  // SHAPE only (additive fields stripped); the RAW address verified above is identity.
  const result = VerdictArtifactSchema.safeParse(raw);
  if (!result.success) {
    rethrowAsParseError(
      `Verdict artifact ${hash} failed schema validation`,
      result.error,
      'The artifact may be corrupted or written by an incompatible totem version; re-emit it (or add the migration entry for its major).',
    );
  }
  return { artifact: result.data, contentHash: hash };
}

/**
 * Verified per-entry load for a SCAN (list / lineage). A KNOWN corruption class —
 * bad JSON, schema violation, or a content-address mismatch (finding 4), all
 * surfaced by {@link loadVerdictArtifact} as a {@link TotemError} — is routed to
 * `onWarn` and the entry is SKIPPED (returns `undefined`). An UNEXPECTED failure
 * (e.g. a filesystem permission error) is rethrown, never swallowed.
 *
 * This is the honest degradation for a scan (vs the hard error of a direct
 * load-by-hash): one corrupt / mis-addressed artifact must neither crash an
 * UNRELATED lineage query nor silently WIN or LOSE a lineage scan by being counted
 * as valid — it is announced LOUDLY per entry and dropped, so a broken prior round
 * makes the chain honestly restart at round 0 (the failure-table "prior verdict
 * missing/corrupt" row) rather than aborting the whole command.
 */
function loadVerifiedVerdictForScan(
  totemDirAbs: string,
  hash: string,
  onWarn: (message: string) => void,
): VerdictWithAddress | undefined {
  try {
    return loadVerdictArtifact(totemDirAbs, hash);
  } catch (err) {
    if (err instanceof TotemError) {
      onWarn(
        `Skipping corrupt or mis-addressed verdict artifact ${hash} during scan: ${err.message}`,
      );
      return undefined;
    }
    throw err;
  }
}

/**
 * Load every stored verdict under `artifacts/verdicts/`, verifying each through
 * the SAME content-address check as {@link loadVerdictArtifact}. A missing
 * directory yields `[]` (nothing written yet). Non-verdict file names are skipped
 * silently; a corrupt / mis-addressed verdict is skipped LOUDLY via `onWarn`
 * (default `console.warn`; injectable so core stays decoupled from the presentation
 * layer) — see {@link loadVerifiedVerdictForScan}.
 */
export function listVerdictArtifacts(
  totemDirAbs: string,
  onWarn: (message: string) => void = console.warn,
): VerdictWithAddress[] {
  const dir = verdictsDir(totemDirAbs);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: VerdictWithAddress[] = [];
  for (const name of names) {
    const match = VERDICT_FILE_RE.exec(name);
    if (match === null) continue;
    const loaded = loadVerifiedVerdictForScan(totemDirAbs, match[1], onWarn);
    if (loaded !== undefined) out.push(loaded);
  }
  return out;
}

/**
 * The latest verdict sharing `lineageKey` — highest `round.index`, ties broken by
 * the lexical STORED content address (rev-5 item 8 / rev-6 item 1), NOT `createdAt`.
 * Returns the winning {@link VerdictWithAddress} (artifact + verified address) or
 * `undefined` when no verdict carries the key. Used for implicit round linkage (the
 * next round's `priorVerdictHash` = the returned `contentHash`, so the link always
 * points at the on-disk file even for a forward-minor artifact). Goes through the same
 * verified scan load as {@link listVerdictArtifacts}: a corrupt / mis-addressed
 * artifact is warned + skipped (never silently winning or losing the lineage), `onWarn`
 * injectable (default `console.warn`).
 *
 * The tie-break is IDENTITY-BOUND and deterministic: two same-round verdicts break on
 * their STORED content address (the on-disk identity, `createdAt` excluded), so
 * selection never depends on wall-clock emission time (observability-only) — the same
 * corpus always resolves the same latest verdict regardless of when each round ran.
 */
export function findLatestVerdictForLineage(
  totemDirAbs: string,
  lineageKey: string,
  onWarn: (message: string) => void = console.warn,
): VerdictWithAddress | undefined {
  const matching = listVerdictArtifacts(totemDirAbs, onWarn).filter(
    (v) => v.artifact.round.lineageKey === lineageKey,
  );
  if (matching.length === 0) return undefined;
  // Tie-break on the STORED, verified content address (rev-6 item 1) — NOT a recompute
  // over the Zod-normalized shape, which would diverge for a forward-minor artifact and
  // could reorder same-round ties. The stored address is the on-disk identity, so the
  // same corpus always resolves the same latest verdict, timestamp-independently.
  const ordered = [...matching].sort((a, b) => {
    if (b.artifact.round.index !== a.artifact.round.index) {
      return b.artifact.round.index - a.artifact.round.index;
    }
    return b.contentHash.localeCompare(a.contentHash);
  });
  return ordered[0]!;
}

/** Best-effort major extraction from a raw parsed payload; undefined when absent/garbled. */
function readMajor(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) return undefined;
  const version = raw.schemaVersion;
  if (typeof version !== 'string') return undefined;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}
