import { describe, expect, it } from 'vitest';

import { getRulePolicy } from './rule-policy.js';

describe('getRulePolicy (ADR-112 §9 single-home)', () => {
  it('mined → held-out-only label scope + held-out controls (the LIVE, byte-identical path)', () => {
    expect(getRulePolicy('mined')).toEqual({
      labelScope: 'held-out-only',
      positiveControlSide: 'held-out',
      exposureControlSide: 'held-out',
    });
  });

  it('authored → whole-window labels + train-side controls (DEFINED for slice D; not yet wired live)', () => {
    expect(getRulePolicy('authored')).toEqual({
      labelScope: 'whole-window',
      positiveControlSide: 'train',
      exposureControlSide: 'train',
    });
  });

  it('mined and authored diverge on label scope (the §9 amendment the scorer reads in slice D)', () => {
    expect(getRulePolicy('mined').labelScope).not.toBe(getRulePolicy('authored').labelScope);
  });
});
