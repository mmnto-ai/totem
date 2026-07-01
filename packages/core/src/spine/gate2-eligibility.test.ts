// ─── ADR-112 §5.3 / §1(k) — Gate-2 eligibility derivation (slice D4) tests ────
//
// Pins the strategy D4 Q1/Q2/Q4 ruling (2026-07-01):
//   • §1(k): a survivor with ZERO held-out activations (absent-from-map ≡ explicit
//     0) is EXCLUDED — never admitted "as if held-out-certified".
//   • Q4: `authoredControlGate.illegitimate > 0` disqualifies the WHOLE window,
//     keyed on the COUNT, never on `.effect` (a co-severe mined FP FAIL can mask
//     the illegitimate control: `effect: 'none'` while `illegitimate > 0`).
//   • Culled rules are never survivors, even with held-out activations.
//   • Deterministic: output preserves `mintedRuleIds` input order (Tenet-15).
//
// Drafted via a Fable draft-then-verify trial (model-tiering #697), verified
// assertion-by-assertion against the source contract before landing.

import { describe, expect, it } from 'vitest';

import { deriveGate2Eligibility } from './gate2-eligibility.js';
import type { CullLedgerEntry } from './windtunnel-scorer.js';
import type {
  AuthoredControlGate,
  AuthoredWindtunnelVerdict,
} from './windtunnel-scorer-authored.js';

// ─── Helpers ─────────────────────────────────────────

type Gate2Verdict = Pick<
  AuthoredWindtunnelVerdict,
  'cullLedger' | 'heldOutActivationsByRule' | 'authoredControlGate'
>;

/**
 * A baseline verdict Pick: clean window (illegitimate 0, effect 'none'), nothing
 * culled, no held-out entries. Each test overrides only what it exercises.
 */
function makeVerdict(overrides?: {
  cullLedger?: CullLedgerEntry[];
  heldOutActivationsByRule?: Record<string, number>;
  authoredControlGate?: Partial<AuthoredControlGate>;
}): Gate2Verdict {
  return {
    cullLedger: overrides?.cullLedger ?? [],
    heldOutActivationsByRule: overrides?.heldOutActivationsByRule ?? {},
    authoredControlGate: {
      illegitimate: 0,
      undecidable: 0,
      deferred: 0,
      effect: 'none',
      ...overrides?.authoredControlGate,
    },
  };
}

function cullEntry(ruleId: string, pr = 10): CullLedgerEntry {
  return {
    ruleId,
    pr,
    filePath: 'src/foo.ts',
    matchedLine: 'const x = 1;',
    reason: 'negative-control-fired',
  };
}

// ─── §5.3: a survivor with held-out activations in a clean window ─────────────

describe('§5.3 eligibility: survivors with held-out activations in a clean window', () => {
  it('a survivor with heldOutActivations > 0 in a non-disqualified window is eligible', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({ heldOutActivationsByRule: { r1: 3 } }),
    });
    expect(result).toEqual({
      eligibleRuleIds: ['r1'],
      survivors: [{ ruleId: 'r1', heldOutActivations: 3, gate2Eligible: true }],
      windowDisqualified: false,
    });
  });
});

// ─── §1(k): zero held-out activations — never admitted "as if certified" ──────

describe('§1(k): zero held-out activations are never admitted', () => {
  it('§1(k): a survivor absent from heldOutActivationsByRule reports 0 and is excluded', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict(),
    });
    expect(result.eligibleRuleIds).toEqual([]);
    expect(result.survivors).toEqual([
      { ruleId: 'r1', heldOutActivations: 0, gate2Eligible: false },
    ]);
    expect(result.windowDisqualified).toBe(false);
  });

  it('§1(k): an explicit 0 entry (the common shape) is excluded, identical to absent', () => {
    const explicit = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({ heldOutActivationsByRule: { r1: 0 } }),
    });
    expect(explicit.eligibleRuleIds).toEqual([]);
    expect(explicit.survivors).toEqual([
      { ruleId: 'r1', heldOutActivations: 0, gate2Eligible: false },
    ]);

    // Absent-from-map ≡ explicit 0 — the two shapes produce an identical emission.
    const absent = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({ heldOutActivationsByRule: {} }),
    });
    expect(explicit).toEqual(absent);
  });
});

// ─── Cull exclusion: a culled rule is never a survivor (codex case (d)) ───────

describe('cull exclusion: culled rules are not survivors', () => {
  it('a culled rule is not a survivor even with heldOutActivations > 0', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({
        cullLedger: [cullEntry('r1')],
        heldOutActivationsByRule: { r1: 5 },
      }),
    });
    // Absent from BOTH survivors[] and eligibleRuleIds — not merely ineligible.
    expect(result).toEqual({
      eligibleRuleIds: [],
      survivors: [],
      windowDisqualified: false,
    });
  });

  it('multiple cull entries for one rule exclude it once, without disturbing others', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1', 'r2'],
      verdict: makeVerdict({
        cullLedger: [cullEntry('r1', 10), cullEntry('r1', 11)],
        heldOutActivationsByRule: { r1: 4, r2: 1 },
      }),
    });
    expect(result).toEqual({
      eligibleRuleIds: ['r2'],
      survivors: [{ ruleId: 'r2', heldOutActivations: 1, gate2Eligible: true }],
      windowDisqualified: false,
    });
  });
});

// ─── Q4: window disqualifier — keyed on the illegitimate COUNT, never .effect ─

describe('Q4: window disqualifier keys on the illegitimate count, never on effect', () => {
  it("Q4: illegitimate > 0 empties eligibility EVEN WHEN effect === 'none'", () => {
    // The masked-control case (`1a80655e`): a co-severe mined FP FAIL absorbed the
    // gate, so `effect` stayed 'none' while `illegitimate > 0`.
    const heldOutActivationsByRule = { r1: 2 };
    const disqualified = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({
        heldOutActivationsByRule,
        authoredControlGate: { illegitimate: 1, effect: 'none' },
      }),
    });
    expect(disqualified.windowDisqualified).toBe(true);
    expect(disqualified.eligibleRuleIds).toEqual([]);
    // The audit trail stays legible: the survivor row reports the TRUE count, ineligible.
    expect(disqualified.survivors).toEqual([
      { ruleId: 'r1', heldOutActivations: 2, gate2Eligible: false },
    ]);

    // Companion: the SAME survivors with illegitimate === 0 (and the SAME effect)
    // ARE eligible — the COUNT drives disqualification, not `.effect`.
    const clean = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({
        heldOutActivationsByRule,
        authoredControlGate: { illegitimate: 0, effect: 'none' },
      }),
    });
    expect(clean.windowDisqualified).toBe(false);
    expect(clean.eligibleRuleIds).toEqual(['r1']);
    expect(clean.survivors).toEqual([{ ruleId: 'r1', heldOutActivations: 2, gate2Eligible: true }]);
  });

  it('Q4: only the illegitimate count disqualifies — not undecidable/deferred/effect', () => {
    // Reachable state: undecidable non-emissions demote to honest-negative while
    // illegitimate === 0. The window is NOT disqualified for Gate-2 purposes.
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({
        heldOutActivationsByRule: { r1: 1 },
        authoredControlGate: {
          illegitimate: 0,
          undecidable: 2,
          deferred: 1,
          effect: 'honest-negative-not-certifiable',
        },
      }),
    });
    expect(result.windowDisqualified).toBe(false);
    expect(result.eligibleRuleIds).toEqual(['r1']);
    expect(result.survivors).toEqual([
      { ruleId: 'r1', heldOutActivations: 1, gate2Eligible: true },
    ]);
  });
});

// ─── Order / determinism (Tenet-15) ───────────────────────────────────────────

describe('order / determinism (Tenet-15)', () => {
  it('preserves mintedRuleIds input order in eligibleRuleIds and survivors', () => {
    // Input order differs from sorted order — a sorted (or Set-iterated) impl fails.
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r3', 'r1', 'r2'],
      verdict: makeVerdict({ heldOutActivationsByRule: { r1: 1, r2: 2, r3: 3 } }),
    });
    expect(result.eligibleRuleIds).toEqual(['r3', 'r1', 'r2']);
    expect(result.survivors).toEqual([
      { ruleId: 'r3', heldOutActivations: 3, gate2Eligible: true },
      { ruleId: 'r1', heldOutActivations: 1, gate2Eligible: true },
      { ruleId: 'r2', heldOutActivations: 2, gate2Eligible: true },
    ]);
  });

  it('a mid-list cull removes its rule without disturbing the order of the rest', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r3', 'r1', 'r2'],
      verdict: makeVerdict({
        cullLedger: [cullEntry('r1')],
        heldOutActivationsByRule: { r2: 2, r3: 3 },
      }),
    });
    expect(result.eligibleRuleIds).toEqual(['r3', 'r2']);
    expect(result.survivors.map((s) => s.ruleId)).toEqual(['r3', 'r2']);
  });
});

// ─── Mixed window: the exact partition ────────────────────────────────────────

describe('mixed window', () => {
  it('partitions culled / eligible / zero-held-out rules exactly', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
      verdict: makeVerdict({
        // r2 is culled DESPITE held-out activations; r3 is an explicit 0; r4 is
        // absent-from-map; r1/r5 are eligible.
        cullLedger: [cullEntry('r2')],
        heldOutActivationsByRule: { r1: 3, r2: 7, r3: 0, r5: 1 },
      }),
    });
    expect(result).toEqual({
      eligibleRuleIds: ['r1', 'r5'],
      survivors: [
        { ruleId: 'r1', heldOutActivations: 3, gate2Eligible: true },
        { ruleId: 'r3', heldOutActivations: 0, gate2Eligible: false },
        { ruleId: 'r4', heldOutActivations: 0, gate2Eligible: false },
        { ruleId: 'r5', heldOutActivations: 1, gate2Eligible: true },
      ],
      windowDisqualified: false,
    });
  });
});

// ─── Empty window + non-minted inputs ─────────────────────────────────────────

describe('empty window and non-minted inputs', () => {
  it('empty mintedRuleIds → empty eligible set, empty survivors, not disqualified', () => {
    const result = deriveGate2Eligibility({ mintedRuleIds: [], verdict: makeVerdict() });
    expect(result).toEqual({ eligibleRuleIds: [], survivors: [], windowDisqualified: false });
  });

  it('empty mintedRuleIds still reports windowDisqualified when illegitimate > 0', () => {
    // The Q4 flag is a window-level fact — reported even with nothing minted.
    const result = deriveGate2Eligibility({
      mintedRuleIds: [],
      verdict: makeVerdict({ authoredControlGate: { illegitimate: 1 } }),
    });
    expect(result).toEqual({ eligibleRuleIds: [], survivors: [], windowDisqualified: true });
  });

  it('held-out keys and cull entries for non-minted rules never reach the output', () => {
    const result = deriveGate2Eligibility({
      mintedRuleIds: ['r1'],
      verdict: makeVerdict({
        cullLedger: [cullEntry('ghost-culled')],
        heldOutActivationsByRule: { r1: 1, 'ghost-held-out': 5 },
      }),
    });
    expect(result).toEqual({
      eligibleRuleIds: ['r1'],
      survivors: [{ ruleId: 'r1', heldOutActivations: 1, gate2Eligible: true }],
      windowDisqualified: false,
    });
  });
});
