import { TotemError } from '../errors.js';

/**
 * Metric-bound relevance (mmnto-ai/totem#2738).
 *
 * A distance is only interpretable against the metric that produced it. The
 * pre-#2738 code hard-coded `1 / (1 + _distance)` at the row-mapping site with
 * no record of which metric LanceDB had actually used, so a metric change
 * anywhere would have silently re-scaled every relevance number in the system.
 * This module makes the metric a named fact and the normalization a map keyed
 * by it: one truth, stated once, quoted in the doc comments below from the
 * LanceDB SDK's own definitions.
 */

/** The distance metrics the LanceDB TypeScript SDK can be asked for (`VectorQuery.distanceType`). */
export type DistanceMetric = 'l2' | 'cosine' | 'dot';

/** Every spelling the SDK accepts — the allow-list `assertDistanceMetric` gates on. */
export const DISTANCE_METRICS: readonly DistanceMetric[] = ['l2', 'cosine', 'dot'];

/**
 * The ONE metric every Totem vector query is issued with (mmnto-ai/totem#2738).
 *
 * Both query sites in `lance-search.ts` chain `.distanceType(VECTOR_DISTANCE_METRIC)`
 * explicitly, so the metric is a recorded fact in the query rather than the SDK
 * default it happens to coincide with. `runSync` also records it in
 * `.totem/index-manifest.json` as `vectorDistanceMetric`.
 */
export const VECTOR_DISTANCE_METRIC: DistanceMetric = 'l2';

/**
 * distance → relevance, one entry per SDK metric.
 *
 * Private on purpose: the map is an implementation of `relevanceFromDistance`,
 * not a second surface callers can reach around it to index.
 */
const RELEVANCE_FROM_DISTANCE: Record<DistanceMetric, (distance: number) => number> = {
  /**
   * SDK: `"l2"` — Euclidean distance, "range of [0, ∞)". MEASURED (R1,
   * mmnto-ai/totem#2738, 3/3 trials, |diff| < 1e-5): what the SDK actually
   * returns in `_distance` for `l2` is the SQUARED Euclidean distance
   * (`lance-linalg` sums `diff * diff` with no sqrt) — a self-hit returns 0,
   * and a pair at cosine 0.845 returned 0.3096 = |a-b|², not |a-b| = 0.5564.
   *
   * On unit-norm vectors |a-b|² = 2 - 2·cos ∈ [0, 4], so relevance ∈ [0.2, 1]
   * (minimum observed: 0.5022 over 3,795 hits on this repo's index).
   *
   * LangChain's euclidean constant presumes a NON-squared distance and is
   * deliberately NOT borrowed — applied to a squared distance it would be
   * wrong. The doctrine (bind the normalization to a named metric) is
   * borrowed; the constant is not.
   */
  l2: (distance: number) => 1 / (1 + distance),
  /**
   * SDK: `"cosine"` — "Cosine distance ... has a range of [0, 2]", i.e.
   * `1 - cos(a, b)`, unaffected by vector magnitude. `1 - distance / 2` maps
   * [0, 2] onto relevance [0, 1] linearly in the cosine.
   */
  cosine: (distance: number) => 1 - distance / 2,
  /**
   * SDK: `"dot"` — "Dot distance has a range of (-∞, ∞). If the vectors are
   * normalized (i.e. their l2 norm is 1), then dot distance is equivalent to
   * the cosine distance" — so LanceDB's dot distance is the `1 - a·b` form and
   * takes the SAME map as `cosine`. On NON-unit vectors it can leave [0, 2] and
   * the relevance then leaves [0, 1]: this is the case the out-of-range warning
   * at the search call sites exists for.
   */
  dot: (distance: number) => 1 - distance / 2,
};

/**
 * Narrow an untrusted value (a manifest field, a config key, a record read off
 * disk) to a `DistanceMetric`, or throw loudly naming the value and every
 * allowed spelling. The type makes an unmapped metric unreachable in code; this
 * is the runtime gate for values that did not come through the type.
 */
export function assertDistanceMetric(value: unknown): DistanceMetric {
  if (typeof value === 'string' && (DISTANCE_METRICS as readonly string[]).includes(value)) {
    return value as DistanceMetric;
  }
  const allowed = DISTANCE_METRICS.map((m) => `"${m}"`).join(', ');
  throw new TotemError(
    'CONFIG_INVALID',
    `Unknown vector distance metric ${JSON.stringify(value)} — the LanceDB SDK accepts only ${allowed}.`,
    `Use one of ${allowed}. These are the SDK's own spellings; "ip"/"inner_product"/"euclidean" are not among them.`,
  );
}

/**
 * Normalize a LanceDB `_distance` into a relevance under the given metric.
 *
 * A pure map with one job: it never warns, never throws on range, and never
 * clamps. The caller judges the result with {@link isRelevanceInRange} and
 * decides what a range breach means at that call site.
 */
export function relevanceFromDistance(metric: DistanceMetric, distance: number): number {
  return RELEVANCE_FROM_DISTANCE[metric](distance);
}

/** Whether a relevance is a finite number inside the closed interval [0, 1]. */
export function isRelevanceInRange(relevance: number): boolean {
  return Number.isFinite(relevance) && relevance >= 0 && relevance <= 1;
}
