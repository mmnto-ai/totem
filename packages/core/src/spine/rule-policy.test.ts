import { describe, expect, it } from 'vitest';

import { getRulePolicy } from './rule-policy.js';

describe('getRulePolicy (ADR-112 §9 single-home)', () => {
  it('mined → held-out-only label scope + held-out controls + no positive-control gate (the LIVE, byte-identical path)', () => {
    expect(getRulePolicy('mined')).toEqual({
      labelScope: 'held-out-only',
      positiveControlSide: 'held-out',
      exposureControlSide: 'held-out',
      positiveControlGate: 'none',
    });
  });

  it('authored → whole-window labels + train-side controls + preimage-differential gate (DEFINED for slice C2b/D)', () => {
    expect(getRulePolicy('authored')).toEqual({
      labelScope: 'whole-window',
      positiveControlSide: 'train',
      exposureControlSide: 'train',
      positiveControlGate: 'preimage-differential',
    });
  });

  it('mined and authored diverge on label scope (the §9 amendment the scorer reads in slice D)', () => {
    expect(getRulePolicy('mined').labelScope).not.toBe(getRulePolicy('authored').labelScope);
  });

  it('mined and authored diverge on the positive-control gate (§4 — authored is differential-gated)', () => {
    expect(getRulePolicy('mined').positiveControlGate).toBe('none');
    expect(getRulePolicy('authored').positiveControlGate).toBe('preimage-differential');
  });

  it('returns a frozen singleton — a caller cannot mutate policy resolution process-wide (#2259)', () => {
    const policy = getRulePolicy('mined');
    // Frozen ⇒ any property write throws in strict mode (ESM), so policy resolution can't be
    // mutated process-wide through the shared reference. `Object.assign` exercises that [[Set]].
    expect(Object.isFrozen(policy)).toBe(true);
    expect(() => Object.assign(policy, { labelScope: 'whole-window' })).toThrow();
    // the next resolution is unaffected by the attempted mutation.
    expect(getRulePolicy('mined').labelScope).toBe('held-out-only');
  });
});
