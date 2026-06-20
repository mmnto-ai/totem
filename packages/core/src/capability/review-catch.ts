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
 * actors rather than minting a parallel scheme (#697 fold 5, corrected c.4755848293).
 * The namespace is `{ cohort agent-seats } ∪ { coderabbit, gemini-code-assist, greptile }`:
 * the three ACTIVE paid review bots (de-facto home: `doctrine/bot-protocols.md` + the
 * parity-manifest `bot-review-configs` dimension) + the cohort seats (a cohort dispatch
 * login already IS its `cohort-roles.md` id). `pr-agent`/`qodo` are research-only/dropped
 * (no shipped #670 backend registry to couple to — forward-couple only IF #670 ships), so
 * they are NOT specially mapped. Model/backend identity is intentionally NOT folded into
 * the id (so the hit-rate aggregates across model swaps).
 */
/** The three active paid review bots → their stable actor-id, keyed by EXACT login. */
const REVIEW_BOT_ACTOR_IDS: Readonly<Record<string, string>> = {
  'coderabbitai[bot]': 'coderabbit',
  'gemini-code-assist[bot]': 'gemini-code-assist',
  'greptile-apps[bot]': 'greptile',
};

export function resolveActorId(author: string): string {
  const trimmed = author.trim();
  if (trimmed.length === 0) {
    // Fail loud: an empty/whitespace login (e.g. a deleted GH user → null author) must
    // never silently mint an empty actor-id (Tenet 4).
    throw new Error('[Totem Error] resolveActorId: author login must be a non-empty string');
  }
  // EXACT login match, NOT a prefix — so a future variant like `greptile-enterprise[bot]`
  // is not silently collapsed into `greptile` and mixed into its hit-rate (greptile P2).
  // A cohort seat login (e.g. `totem-claude`) is unknown here → returned as its own id.
  return REVIEW_BOT_ACTOR_IDS[trimmed.toLowerCase()] ?? trimmed;
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
          // `?.trim() ||` (not `??`) so an empty/whitespace evidenceRef/resolvedAt falls
          // back instead of tripping the schema's non-empty/datetime guards (GCA).
          evidenceRef: f.dispositionEvidenceRef?.trim() || nativeKey,
          resolvedAt: f.resolvedAt?.trim() || f.assertedAt,
        }),
      );
    }
    // silence (no disposition) → no resolution row → regenerator buckets it `unresolved`.
  }

  return { claims, resolutions };
}
