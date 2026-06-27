// ─── ADR-112 §9 — the producer-kind → override SINGLE HOME ───────────────────
//
// The one place behaviour switches on `provenance.kind`. ADR-112 §9 amends the
// upstream contracts (ADR-110/111) with a table of producer-kind overrides;
// rather than smear a `switch(kind)` across derive-labels / scorer / materializer
// (N scattered branches — the gemini break), every consumer asks THIS function
// "how do I handle a rule of this kind?" (Tenet 20 single-home).
//
// SLICE A scope: the home + the MINED policy are wired live (mined behaviour is
// byte-identical to pre-ADR-112). The AUTHORED policy is DEFINED here (so slice
// D extends one place, not many) but NO scorer/derive-labels/materializer
// consumer reads it yet — the operational window-wide label derivation, the
// train-side control materialization, and the held-out-activation metric are
// slice D. Until then a run is single-producer (`provenanceKind` on the lock,
// default `mined`); a mixed-kind corpus is out of scope for the first cert (§7).

/** ADR-112 — a rule's producer kind (the `provenance.kind` discriminator). */
export type ProducerKind = 'mined' | 'authored';

/**
 * The producer-kind override config (ADR-112 §9). Each field is an upstream
 * contract behaviour that authoring changes relative to mining:
 *   - `labelScope`           — §9: mined labels the held-out slice only; authored
 *                              must label EVERY non-control firing across BOTH
 *                              slices, else a train-slice FP has no label and
 *                              escapes the precision-1.0 FAIL.
 *   - `positiveControlSide`  — §6: mined positive controls are held-out; authored
 *                              positive controls are TRAIN-side (the rule is
 *                              authored against the train slice).
 *   - `exposureControlSide`  — §5.3: which slice `positiveControlsExercised`
 *                              counts. Mirrors `positiveControlSide`.
 */
export interface RulePolicy {
  // `readonly` + `Object.freeze` (#2259): `getRulePolicy` hands these singletons out
  // by reference, so a single caller mutation would change policy resolution
  // process-wide. The fields are immutable by contract and frozen at runtime.
  readonly labelScope: 'held-out-only' | 'whole-window';
  readonly positiveControlSide: 'held-out' | 'train';
  readonly exposureControlSide: 'held-out' | 'train';
}

const MINED_POLICY: RulePolicy = Object.freeze({
  labelScope: 'held-out-only',
  positiveControlSide: 'held-out',
  exposureControlSide: 'held-out',
});

const AUTHORED_POLICY: RulePolicy = Object.freeze({
  labelScope: 'whole-window',
  positiveControlSide: 'train',
  exposureControlSide: 'train',
});

/**
 * ADR-112 §9 — resolve the override config for a producer kind. Pure +
 * exhaustive over the 2-value union. The MINED branch is the live, byte-identical
 * path; the AUTHORED branch is defined for slice D's consumers (not yet wired).
 */
export function getRulePolicy(kind: ProducerKind): RulePolicy {
  switch (kind) {
    case 'mined':
      return MINED_POLICY;
    case 'authored':
      return AUTHORED_POLICY;
    default: {
      const _exhaustive: never = kind;
      throw new Error(
        `[Totem Error] getRulePolicy: unknown producer kind '${String(_exhaustive)}'`,
      );
    }
  }
}
