import {
  type CompiledRule,
  type CompiledRulesFile,
  CompiledRulesFileSchema,
  deriveRuleClass,
  type Legitimacy,
  type ProvenanceRecord,
} from '../compiler-schema.js';
import type { PerRuleControlResult } from './windtunnel-firing.js';
import type { WindtunnelVerdict } from './windtunnel-scorer.js';

// ─── fold-B: verdict → per-rule legitimacy projection ───

export interface LegitimacyProjectionInput {
  /** The scorer's run-level verdict. Only PASS stamps survivors (§6 L3). */
  verdict: WindtunnelVerdict;
  /**
   * C1 per-rule control results over the SURVIVORS (active, non-culled rules),
   * keyed by ruleId (= lessonHash). A rule absent here is not a survivor.
   */
  perRuleControls: Map<string, PerRuleControlResult>;
  /** Candidate (minted) compiled rules to consider for stamping. */
  candidates: CompiledRule[];
  /** Mining provenance per rule (lessonHash → provenance) from the compile stage. */
  provenanceByRule: Map<string, ProvenanceRecord>;
}

/** A rule that was NOT stamped, with the reason — for the cert-run report. */
export type LegitimacyProjectionSkip =
  | { reason: 'verdict-not-pass'; verdict: WindtunnelVerdict['verdict'] }
  | { reason: 'not-a-survivor' | 'missing-provenance'; ruleId: string };

export interface LegitimacyProjectionResult {
  /** Survivor rules stamped with legitimacy + ruleClass (PASS-only; else empty). */
  stamped: CompiledRule[];
  /** Run-level + per-rule skips (never silently dropped — they feed the report). */
  skips: LegitimacyProjectionSkip[];
}

/**
 * fold-B — project the wind-tunnel verdict + C1 per-rule control results onto
 * per-rule legitimacy stamps, SURVIVOR-ONLY and PASS-ONLY (ADR-110; §6 L3).
 *
 *  - verdict ≠ PASS ⟹ stamp NOTHING. HONEST-NEGATIVE / FAIL / needs-adjudication
 *    are non-terminals; they belong in the cert-run report, never the live
 *    corpus (corpus population is strategy#516's job).
 *  - On PASS, each survivor (present in `perRuleControls`) is stamped with
 *    `legitimacy = {provenance, positiveControl, negativeControl}` from its OWN
 *    control result (never the global `nonVacuity`, which would over-stamp a rule
 *    that never exercised a control). `unverified` is flipped to `false` ONLY
 *    when BOTH controls passed (binding-4: never promote until the verdict
 *    promotes); otherwise it stays `true` ⟹ advisory. `ruleClass` is
 *    `deriveRuleClass(...)` over the stamped fields, so the legitimacy⇔ruleClass
 *    consistency superRefine in `CompiledRuleSchema` holds by construction (the
 *    fold-C parse-before-write net then re-checks it before any bytes hit disk).
 *
 * Pure: no IO, no clock. Returns new rule objects; inputs are not mutated.
 */
export function projectLegitimacy(input: LegitimacyProjectionInput): LegitimacyProjectionResult {
  const { verdict, perRuleControls, candidates, provenanceByRule } = input;

  if (verdict.verdict !== 'PASS') {
    return { stamped: [], skips: [{ reason: 'verdict-not-pass', verdict: verdict.verdict }] };
  }

  const stamped: CompiledRule[] = [];
  const skips: LegitimacyProjectionSkip[] = [];
  for (const rule of candidates) {
    const control = perRuleControls.get(rule.lessonHash);
    if (!control) {
      // Not a survivor (culled by a negative control, or never minted) — never stamped.
      skips.push({ reason: 'not-a-survivor', ruleId: rule.lessonHash });
      continue;
    }
    const provenance = provenanceByRule.get(rule.lessonHash);
    if (!provenance) {
      // A survivor without provenance cannot be legitimately stamped — surface it
      // (a provenance gap is a real defect) rather than fabricate a marker.
      skips.push({ reason: 'missing-provenance', ruleId: rule.lessonHash });
      continue;
    }
    const legitimacy: Legitimacy = {
      provenance,
      positiveControl: control.positiveControl,
      negativeControl: control.negativeControl,
    };
    // binding-4: promote (unverified:false) ONLY when both controls passed.
    const unverified = !(control.positiveControl && control.negativeControl);
    const ruleClass = deriveRuleClass({ legitimacy, unverified });
    stamped.push({ ...rule, legitimacy, ruleClass, unverified });
  }
  return { stamped, skips };
}

// ─── fold-C: parse-before-write net ──────────────────

/**
 * fold-C — assemble the compiled-rules file payload and run it through
 * `CompiledRulesFileSchema.parse` IMMEDIATELY before persistence, so any
 * half-stamped rule (legitimacy without ruleClass, ruleClass without legitimacy,
 * or an inconsistent ruleClass — the consistency superRefine) fails LOUD BEFORE
 * a single byte reaches disk. The certifying orchestrator passes the returned,
 * validated `CompiledRulesFile` straight to `saveCompiledRulesFile`. Pure:
 * throws (`ZodError`) on inconsistency, never writes.
 */
export function buildCertifiedRulesFile(stamped: CompiledRule[]): CompiledRulesFile {
  return CompiledRulesFileSchema.parse({ version: 1, rules: stamped });
}
