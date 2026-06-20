// ─── #697 Layer-B — review-catch back-miner (the first column) ───────────────
//
// Back-mines the review-catch capability column from PR review primitives: each posted
// review finding is a CLAIM by its author; its disposition (held = accepted+fixed →
// correct, declined-as-FP → wrong, silence → unresolved-by-absence) is the RESOLUTION.
// Author-adjudicated correctness, identical scope to #670. Pure + deterministic: it
// consumes already-mined findings through an injected port (the live GitHub fetch +
// `bot-review-parser` disposition read is the CLI-side adapter, a follow-on); core stays
// network/LLM-free. No LLM-judge — the resolution is a deterministic disposition read
// (resolutionSource `disposition-thread`), so FM-b holds.

import {
  type CapabilityClaim,
  CapabilityClaimSchema,
  type CapabilityResolution,
  CapabilityResolutionSchema,
  deriveClaimId,
} from './schema.js';

/** The injected port's output — one mined review finding per review comment. */
export interface MinedReviewFinding {
  /** GitHub review-comment numeric id (REST exposes no GraphQL node_id) — the nativeKey source. */
  commentId: number;
  /** GitHub author login (a review-bot or a cohort seat). */
  author: string;
  /** Provenance ref of the thread/PR, e.g. `mmnto-ai/totem#2205`. */
  prRef: string;
  /** The commit the finding was asserted against (lowercase 40-hex). */
  commitSha: string;
  /** When the finding was posted (ISO). */
  assertedAt: string;
  /**
   * The deterministic disposition read (reusing `bot-review-parser`'s taxonomy):
   * `accepted` → held → `correct`; `declined` → wrong → `wrong`; `undefined` = silence
   * (no disposition, no fix) → NO resolution row → the regenerator derives `unresolved`
   * (strategy pin: never count silence as a miss).
   */
  disposition?: 'accepted' | 'declined';
  /** The disposition comment id / fix-commit ref the read was grounded in. */
  dispositionEvidenceRef?: string;
  /** When the disposition was made (ISO); falls back to `assertedAt`. */
  resolvedAt?: string;
}

const REVIEW_CATCH_CLAIM_KIND = 'review-finding';

export interface ReviewCatchMineResult {
  claims: CapabilityClaim[];
  resolutions: CapabilityResolution[];
}

/**
 * Resolve a GitHub author login to a stable Layer-B actor-id, COUPLING to existing
 * registries rather than minting a parallel scheme (#697 fold 5): review backends →
 * the #670/#699 adapter catalog ids; cohort seats → their `cohort-roles.md` id (which a
 * cohort dispatch login already is). Model/backend identity is intentionally NOT folded
 * into the id (so the hit-rate aggregates across model swaps).
 */
export function resolveActorId(author: string): string {
  const a = author.trim().toLowerCase();
  if (a.startsWith('coderabbit')) return 'cr';
  if (a.startsWith('gemini-code-assist')) return 'gca';
  if (a.startsWith('greptile')) return 'greptile';
  if (a.startsWith('pr-agent') || a.startsWith('qodo')) return 'pr-agent-L1';
  // A cohort seat (e.g. `totem-claude`, `strategy-codex`) — the login IS the actor-id.
  return author.trim();
}

/**
 * Mine the review-catch column from a list of findings. One claim per finding; a
 * resolution only when the finding carries a disposition (silence → unresolved by
 * absence). Deterministic: `claimId`/`resolutionId` derive from the finding's stable
 * `commentId`, so re-mining identical history yields identical rows.
 */
export function mineReviewCatch(findings: readonly MinedReviewFinding[]): ReviewCatchMineResult {
  const claims: CapabilityClaim[] = [];
  const resolutions: CapabilityResolution[] = [];

  for (const f of findings) {
    const nativeKey = `gh-review-comment:${f.commentId}`;
    const agentSource = resolveActorId(f.author);
    const claimId = deriveClaimId({
      agentSource,
      taskType: 'review-catch',
      claimKind: REVIEW_CATCH_CLAIM_KIND,
      provenanceRef: f.prRef,
      commitSha: f.commitSha,
      nativeKey,
    });

    claims.push(
      CapabilityClaimSchema.parse({
        claimId,
        agentSource,
        taskType: 'review-catch',
        claimKind: REVIEW_CATCH_CLAIM_KIND,
        provenance: { ref: f.prRef, commitSha: f.commitSha },
        nativeKey,
        assertedAt: f.assertedAt,
      }),
    );

    if (f.disposition === 'accepted' || f.disposition === 'declined') {
      resolutions.push(
        CapabilityResolutionSchema.parse({
          resolutionId: `rc-res:${f.commentId}`,
          claimId,
          outcome: f.disposition === 'accepted' ? 'correct' : 'wrong',
          // Deterministic read of the disposition primitive — never an LLM-judge (FM-b).
          resolutionSource: 'disposition-thread',
          evidenceRef: f.dispositionEvidenceRef ?? nativeKey,
          resolvedAt: f.resolvedAt ?? f.assertedAt,
        }),
      );
    }
    // silence (no disposition) → no resolution row → regenerator buckets it `unresolved`.
  }

  return { claims, resolutions };
}
