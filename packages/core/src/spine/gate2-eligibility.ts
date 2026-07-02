// ─── ADR-112 §5.3 — the Gate-2-eligible set (slice D4) ───────────────────────
//
// A DOWNSTREAM, verdict-inert derivation over the authored window-tunnel verdict.
// It answers one question per surviving authored rule: is it eligible for Gate 2
// (hard-enforce)? Per strategy's D4 Q1/Q2 ruling (2026-07-01, couple-on-merge):
//
//   • Q2 — this lives DOWNSTREAM of the scorer, NOT inside it (gemini/codex/agy +
//     strategy unanimous, Tenet-20 join-back-once): `scoreAuthoredWindtunnel`
//     emits the raw signal (`heldOutActivationsByRule` + `cullLedger`); THIS fn
//     performs the intersection. It never re-scores and never touches the Gate-1
//     verdict — the eligible set "affects only Gate-2 eligibility" (§5.3).
//   • §1(k) is enforced HERE: a survivor with ZERO held-out activations is
//     EXCLUDED — never admitted "as if held-out-certified". Absent-from-map ≡ an
//     explicit `0` ≡ ineligible (codex: D3 records a non-culled rule with a valid
//     positive control + zero held-out firings as an explicit `0`, not absent).
//   • Q4 — a window with `authoredControlGate.illegitimate > 0` is FAIL-equivalent:
//     NO survivor is eligible, EVEN WHEN `effect === 'none'` (a co-severe mined FP
//     FAIL masked the illegitimate control — the equal-severity demote-only branch,
//     `1a80655e`). We disqualify on the `illegitimate` COUNT, NEVER on `.effect`.
//
// Emitted, not hidden (§5.3, Tenet-4): a computed-but-hidden set is a silent
// artifact. The per-survivor `survivors[]` record shows every survivor
// considered + why excluded, so the (k) exclusion is auditable, not inferred.

import type { AuthoredWindtunnelVerdict } from './windtunnel-scorer-authored.js';

/** Per-survivor Gate-2 legibility — one row per surviving (non-culled) authored rule. */
export interface Gate2SurvivorRecord {
  ruleId: string;
  /** Held-out non-control activation count (the §5.3 O3 metric). Absent-from-map is reported as 0. */
  heldOutActivations: number;
  /** Eligible ⟺ NOT window-disqualified AND `heldOutActivations > 0` (§1(k)). */
  gate2Eligible: boolean;
}

/** The Gate-2 eligibility emission — a report field sibling to `heldOutActivationsByRule` (Q2). */
export interface Gate2Eligibility {
  /** The eligible rule ids — survivors with > 0 held-out activations in a non-disqualified window. */
  eligibleRuleIds: string[];
  /** Every survivor considered (the audit trail; (k) exclusions are legible here, not silent). */
  survivors: Gate2SurvivorRecord[];
  /** True ⟺ `authoredControlGate.illegitimate > 0` — the whole window is FAIL-equivalent (Q4). */
  windowDisqualified: boolean;
}

/**
 * Derive the Gate-2-eligible set from a scored authored verdict + the run's minted
 * rule ids. Pure + deterministic (Tenet-15): output preserves `mintedRuleIds` order;
 * no Set/Map iteration leaks into the result.
 *
 * `mintedRuleIds` is NOT a verdict field (the verdict carries only `mintedRuleCount`)
 * — it is the run's minted set, threaded from the engine result. Keys align: an
 * authored rule's `mintedRuleId` IS its `heldOutActivationsByRule` key (both are the
 * persisted `ruleId`; C2a `firingLabelId ← ruleId`).
 */
export function deriveGate2Eligibility(input: {
  mintedRuleIds: readonly string[];
  verdict: Pick<
    AuthoredWindtunnelVerdict,
    'cullLedger' | 'heldOutActivationsByRule' | 'authoredControlGate'
  >;
}): Gate2Eligibility {
  const { mintedRuleIds, verdict } = input;

  // Q4: window-level disqualifier — keyed on the COUNT, never `.effect` (a co-severe
  // mined FP FAIL can mask an illegitimate control: `effect: 'none'` while `illegitimate > 0`).
  const windowDisqualified = verdict.authoredControlGate.illegitimate > 0;

  const culledRuleIds = new Set(verdict.cullLedger.map((entry) => entry.ruleId));

  // Survivors = minted \ culled. A culled rule is never Gate-2-eligible, even if it
  // had held-out activations (codex case (d)).
  const survivors: Gate2SurvivorRecord[] = mintedRuleIds
    .filter((ruleId) => !culledRuleIds.has(ruleId))
    .map((ruleId) => {
      const heldOutActivations = verdict.heldOutActivationsByRule[ruleId] ?? 0;
      const gate2Eligible = !windowDisqualified && heldOutActivations > 0;
      return { ruleId, heldOutActivations, gate2Eligible };
    });

  const eligibleRuleIds = survivors
    .filter((survivor) => survivor.gate2Eligible)
    .map((survivor) => survivor.ruleId);

  return { eligibleRuleIds, survivors, windowDisqualified };
}
