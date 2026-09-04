import { describe, expect, it } from 'vitest';

import { TotemError } from '../errors.js';
import type { DistanceMetric } from './relevance.js';
import {
  assertDistanceMetric,
  DISTANCE_METRICS,
  isRelevanceInRange,
  OUT_OF_RANGE_CAUSE,
  relevanceFromDistance,
  VECTOR_DISTANCE_METRIC,
} from './relevance.js';

// ─── The pinned map (mmnto-ai/totem#2738) ────────────────
//
// These numbers are the contract, not an implementation echo. `l2` is pinned to
// the MEASURED fact that LanceDB's `_distance` for `l2` is the SQUARED
// Euclidean distance (R1, 3/3 trials): a self-hit is 0, and the measured pair
// at cosine 0.845 came back as 0.3096 = |a-b|². On unit-norm vectors that puts
// `_distance` in [0, 4] and therefore relevance in [0.2, 1].

describe('relevanceFromDistance — l2', () => {
  it('maps a self-hit (d = 0) to relevance 1', () => {
    expect(relevanceFromDistance('l2', 0)).toBe(1);
  });

  it('maps the antipodal unit-vector bound (d = 4) to relevance 0.2', () => {
    expect(relevanceFromDistance('l2', 4)).toBeCloseTo(0.2, 10);
  });

  it('maps the R1-measured pair (d = 0.3096, cosine 0.845) to ~0.7636', () => {
    expect(relevanceFromDistance('l2', 0.3096)).toBeCloseTo(0.7636, 4);
  });

  it('is monotone decreasing in distance', () => {
    const distances = [0, 0.25, 0.3096, 0.5, 1, 2, 3, 4, 10];
    const relevances = distances.map((d) => relevanceFromDistance('l2', d));
    for (let i = 1; i < relevances.length; i += 1) {
      expect(relevances[i]!).toBeLessThan(relevances[i - 1]!);
    }
  });

  it('INVARIANT: unit-norm rows produce relevance in [0.2, 1]', () => {
    // On unit vectors |a-b|² = 2 - 2·cos ∈ [0, 4]; the sweep walks that interval.
    for (const d of [0, 0.5, 1, 2, 3, 4]) {
      const relevance = relevanceFromDistance('l2', d);
      expect(relevance).toBeGreaterThanOrEqual(0.2);
      expect(relevance).toBeLessThanOrEqual(1);
      expect(isRelevanceInRange(relevance)).toBe(true);
    }
  });
});

describe('relevanceFromDistance — cosine', () => {
  it('maps d = 0 to 1', () => {
    expect(relevanceFromDistance('cosine', 0)).toBe(1);
  });

  it('maps the far bound d = 2 to 0', () => {
    expect(relevanceFromDistance('cosine', 2)).toBe(0);
  });

  it('maps the orthogonal midpoint d = 1 to 0.5', () => {
    expect(relevanceFromDistance('cosine', 1)).toBe(0.5);
  });
});

describe('relevanceFromDistance — dot', () => {
  // The SDK: "If the vectors are normalized (i.e. their l2 norm is 1), then dot
  // distance is equivalent to the cosine distance" — so `dot` takes the same map.
  it('maps d = 0 to 1', () => {
    expect(relevanceFromDistance('dot', 0)).toBe(1);
  });

  it('maps d = 2 to 0', () => {
    expect(relevanceFromDistance('dot', 2)).toBe(0);
  });

  it('maps d = 1 to 0.5', () => {
    expect(relevanceFromDistance('dot', 1)).toBe(0.5);
  });

  it('agrees with cosine at every pinned point (the SDK equivalence on unit vectors)', () => {
    for (const d of [0, 0.5, 1, 1.5, 2]) {
      expect(relevanceFromDistance('dot', d)).toBe(relevanceFromDistance('cosine', d));
    }
  });
});

// ─── Out-of-range detection ─────────────────────────────
//
// `relevanceFromDistance` computes; it never warns, throws or clamps. The range
// judgment is `isRelevanceInRange`, exercised at the search call sites.

describe('isRelevanceInRange', () => {
  it('is false for an l2 relevance above 1 (a negative _distance)', () => {
    const relevance = relevanceFromDistance('l2', -0.5);
    expect(relevance).toBeCloseTo(2, 10);
    expect(isRelevanceInRange(relevance)).toBe(false);
  });

  it('is false for a cosine relevance below 0 (a distance past the [0, 2] bound)', () => {
    const relevance = relevanceFromDistance('cosine', 3);
    expect(relevance).toBeCloseTo(-0.5, 10);
    expect(isRelevanceInRange(relevance)).toBe(false);
  });

  it('is false for NaN and Infinity', () => {
    expect(isRelevanceInRange(Number.NaN)).toBe(false);
    expect(isRelevanceInRange(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRelevanceInRange(Number.NEGATIVE_INFINITY)).toBe(false);
  });

  it('is true at both closed bounds', () => {
    expect(isRelevanceInRange(0)).toBe(true);
    expect(isRelevanceInRange(1)).toBe(true);
  });
});

// ─── The loud gate ──────────────────────────────────────

describe('assertDistanceMetric', () => {
  it('throws a TotemError naming the value and the three allowed spellings', () => {
    // 'ip' is a metric name from OTHER vector databases; the LanceDB SDK has no
    // such spelling, and guessing it silently would be exactly the drift #2738
    // exists to stop.
    expect(() => assertDistanceMetric('ip')).toThrow(TotemError);
    let thrown: unknown;
    try {
      assertDistanceMetric('ip');
    } catch (err) {
      thrown = err;
    }
    const thrownError = thrown as TotemError;
    expect(thrownError.code).toBe('CONFIG_INVALID');
    expect(thrownError.message).toContain('"ip"');
    expect(thrownError.message).toContain('"l2"');
    expect(thrownError.message).toContain('"cosine"');
    expect(thrownError.message).toContain('"dot"');
  });

  it('returns the metric unchanged for a valid spelling', () => {
    expect(assertDistanceMetric('cosine')).toBe('cosine');
  });

  it('accepts every listed metric and rejects non-strings', () => {
    for (const metric of DISTANCE_METRICS) {
      expect(assertDistanceMetric(metric)).toBe(metric);
    }
    expect(() => assertDistanceMetric(undefined)).toThrow(TotemError);
    expect(() => assertDistanceMetric(null)).toThrow(TotemError);
    expect(() => assertDistanceMetric(2)).toThrow(TotemError);
  });
});

describe('VECTOR_DISTANCE_METRIC', () => {
  it('is the l2 metric the store queries with', () => {
    expect(VECTOR_DISTANCE_METRIC).toBe('l2');
    expect(DISTANCE_METRICS).toContain(VECTOR_DISTANCE_METRIC);
  });
});

// ─── the falsification round's folds (mmnto-ai/totem#2738) ───

describe('relevanceFromDistance gates its metric (F5)', () => {
  it('raises the named TotemError for a spelling that reached it past the type', () => {
    // A value read off a record, an `any`, or a JS caller can carry 'ip' here.
    // Indexing the map with it would have thrown a bare TypeError ("is not a
    // function"); the named error says what is wrong and what is allowed.
    const badMetric = 'ip' as unknown as DistanceMetric;
    expect(() => relevanceFromDistance(badMetric, 0.5)).toThrow(TotemError);
    let thrown: unknown;
    try {
      relevanceFromDistance(badMetric, 0.5);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as TotemError).code).toBe('CONFIG_INVALID');
    expect((thrown as TotemError).message).toContain('"ip"');
  });

  it('still computes for every valid metric', () => {
    for (const metric of DISTANCE_METRICS) {
      expect(Number.isFinite(relevanceFromDistance(metric, 0.5))).toBe(true);
    }
  });
});

describe('OUT_OF_RANGE_CAUSE is metric-specific (F1)', () => {
  it('names a FAULT for l2, never a non-unit-norm embedder', () => {
    // Squared L2 is >= 0 by construction, so 1/(1+d) is in (0, 1] for every
    // value the SDK can legally return: no vector norm can push it out.
    expect(OUT_OF_RANGE_CAUSE.l2).toContain('which squared L2 cannot produce');
    expect(OUT_OF_RANGE_CAUSE.l2).not.toContain('unit-norm');
  });

  it('names ONLY the negative-distance case for l2 — a non-finite one never reaches it', () => {
    // The search layer requires `Number.isFinite` before the map runs at BOTH
    // sites, so a non-finite `_distance` yields no relevance and cannot produce
    // a breach. Naming it would describe a report this warning cannot make.
    expect(OUT_OF_RANGE_CAUSE.l2).toContain('a negative _distance');
    expect(OUT_OF_RANGE_CAUSE.l2).not.toContain('non-finite');
  });

  it('names the unit-norm cause for cosine and dot, where the mapping really can leave [0, 1]', () => {
    expect(OUT_OF_RANGE_CAUSE.cosine).toContain('unit-norm');
    expect(OUT_OF_RANGE_CAUSE.dot).toContain('unit-norm');
    // `dot` on a non-unit vector is the live case: q·[2,0,0] = 2 → d = -1 → 1.5.
    expect(isRelevanceInRange(relevanceFromDistance('dot', -1))).toBe(false);
  });

  it('has an entry for every metric', () => {
    for (const metric of DISTANCE_METRICS) {
      expect(OUT_OF_RANGE_CAUSE[metric].length).toBeGreaterThan(0);
    }
  });
});

describe('DISTANCE_METRICS', () => {
  // The allow-list `assertDistanceMetric` gates on is frozen at runtime, not only
  // `readonly` in the type: a JS caller that pushed a spelling onto it would
  // otherwise pass the gate and reach an undefined map entry (CodeRabbit on
  // mmnto-ai/totem#2761). Pinned so a refactor cannot drop the freeze unnoticed.
  it('is frozen at runtime', () => {
    expect(Object.isFrozen(DISTANCE_METRICS)).toBe(true);
    expect(() => (DISTANCE_METRICS as unknown as string[]).push('euclidean')).toThrow();
    expect(DISTANCE_METRICS).toEqual(['l2', 'cosine', 'dot']);
  });
});
