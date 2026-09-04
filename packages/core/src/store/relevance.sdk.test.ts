/**
 * SDK-MEASURED metric pinning (mmnto-ai/totem#2738 falsification round, F7).
 *
 * The rest of the relevance suite pins the MAP; it cannot tell you whether the
 * map matches what LanceDB actually returns. The `dot` entry in particular was
 * derived from the SDK's DOC COMMENT ("if the vectors are normalized … dot
 * distance is equivalent to the cosine distance") and never measured — a doc
 * comment is a claim, not a measurement, and it is silent about what happens
 * off the unit sphere. This file is the falsifier that gap wanted: it builds a
 * throwaway LanceDB table with hand-chosen vectors, queries it under each of
 * the SDK's three metrics, and asserts the RETURNED `_distance` before feeding
 * each measured value through the map.
 *
 * If a future SDK bump changes a distance convention — l2 stops being squared,
 * dot flips sign, the default stops being l2 — this file goes red at the exact
 * number that moved, instead of every relevance in the system quietly
 * re-scaling behind a green suite.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as lancedb from '@lancedb/lancedb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import type { DistanceMetric } from './relevance.js';
import { isRelevanceInRange, relevanceFromDistance, VECTOR_DISTANCE_METRIC } from './relevance.js';

/** The query vector every measurement below is taken against. */
const QUERY = [1, 0, 0];

/**
 * Hand-chosen probes. Four are unit-norm (where all three metrics are supposed
 * to agree up to their own scale); `scaled-2x` is deliberately NOT, because
 * that is the only place `cosine` and `dot` come apart and the only way to
 * observe a `dot` distance outside [0, 2].
 */
const ROWS = [
  { id: 'identical', vector: [1, 0, 0] },
  { id: 'orthogonal', vector: [0, 1, 0] },
  { id: 'opposite', vector: [-1, 0, 0] },
  { id: 'unit-0.6', vector: [0.6, 0.8, 0] },
  { id: 'scaled-2x', vector: [2, 0, 0] },
];

/** MEASURED `_distance` per metric, asserted to 1e-6 against the live SDK. */
const EXPECTED_DISTANCE: Record<DistanceMetric, Record<string, number>> = {
  // Squared Euclidean: |q - v|². identical 0; orthogonal 2; opposite 4;
  // unit-0.6 0.4² + 0.8² = 0.8; scaled-2x |(-1,0,0)|² = 1.
  l2: { identical: 0, orthogonal: 2, opposite: 4, 'unit-0.6': 0.8, 'scaled-2x': 1 },
  // 1 - cos: magnitude-independent, so scaled-2x collapses onto identical.
  cosine: { identical: 0, orthogonal: 1, opposite: 2, 'unit-0.6': 0.4, 'scaled-2x': 0 },
  // 1 - q·v: identical to cosine on unit vectors, and NOT on scaled-2x, where
  // 1 - 2 = -1 leaves the [0, 2] interval entirely.
  dot: { identical: 0, orthogonal: 1, opposite: 2, 'unit-0.6': 0.4, 'scaled-2x': -1 },
};

/** The relevance the map must produce for each MEASURED distance above. */
const EXPECTED_RELEVANCE: Record<DistanceMetric, Record<string, number>> = {
  l2: { identical: 1, orthogonal: 1 / 3, opposite: 0.2, 'unit-0.6': 5 / 9, 'scaled-2x': 0.5 },
  cosine: { identical: 1, orthogonal: 0.5, opposite: 0, 'unit-0.6': 0.8, 'scaled-2x': 1 },
  dot: { identical: 1, orthogonal: 0.5, opposite: 0, 'unit-0.6': 0.8, 'scaled-2x': 1.5 },
};

describe('LanceDB SDK distance metrics, measured (mmnto-ai/totem#2738, F7)', () => {
  let tmpDir: string;
  let table: lancedb.Table;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lance-metric-'));
    const db = await lancedb.connect(tmpDir);
    table = await db.createTable('probes', ROWS);
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** Query under `metric`, or under the SDK DEFAULT when none is given. */
  async function measure(metric?: DistanceMetric): Promise<Map<string, number>> {
    let q = table.vectorSearch(QUERY).limit(ROWS.length);
    if (metric !== undefined) q = q.distanceType(metric);
    const rows = await q.toArray();
    const byId = new Map<string, number>();
    for (const row of rows) byId.set(String(row['id']), Number(row['_distance']));
    return byId;
  }

  it('the SDK DEFAULT is l2, and l2 is the SQUARED Euclidean distance', async () => {
    const byDefault = await measure();
    const byL2 = await measure('l2');

    for (const { id } of ROWS) {
      const expected = EXPECTED_DISTANCE.l2[id]!;
      expect(byDefault.get(id)).toBeCloseTo(expected, 6);
      expect(byL2.get(id)).toBeCloseTo(expected, 6);
    }
    // `opposite` is the discriminator: |q - v| = 2 but |q - v|² = 4. A
    // non-squared l2 would return 2 here and the whole [0.2, 1] bound would be
    // wrong. This is what the store relies on, hence the constant.
    expect(byL2.get('opposite')).toBeCloseTo(4, 6);
    expect(VECTOR_DISTANCE_METRIC).toBe('l2');
  });

  it('cosine returns 1 - cos over [0, 2] and ignores magnitude', async () => {
    const byCosine = await measure('cosine');
    for (const { id } of ROWS) {
      expect(byCosine.get(id)).toBeCloseTo(EXPECTED_DISTANCE.cosine[id]!, 6);
    }
    // Magnitude-independence, measured: a 2x-scaled copy of the query is at
    // distance 0, exactly where the query itself is.
    expect(byCosine.get('scaled-2x')).toBeCloseTo(byCosine.get('identical')!, 6);
  });

  it('dot returns 1 - a·b: equal to cosine on unit vectors, and NEGATIVE off them', async () => {
    const byDot = await measure('dot');
    const byCosine = await measure('cosine');

    for (const { id } of ROWS) {
      expect(byDot.get(id)).toBeCloseTo(EXPECTED_DISTANCE.dot[id]!, 6);
    }
    // The SDK's documented equivalence, now MEASURED rather than quoted — on
    // the four unit-norm probes only.
    for (const id of ['identical', 'orthogonal', 'opposite', 'unit-0.6']) {
      expect(byDot.get(id)).toBeCloseTo(byCosine.get(id)!, 6);
    }
    // And where the doc comment is silent: off the unit sphere the two diverge
    // and dot leaves [0, 2] altogether.
    expect(byDot.get('scaled-2x')).toBeCloseTo(-1, 6);
    expect(byDot.get('scaled-2x')).not.toBeCloseTo(byCosine.get('scaled-2x')!, 6);
  });

  it('the map turns every MEASURED distance into the pinned relevance', async () => {
    for (const metric of ['l2', 'cosine', 'dot'] as const) {
      const measured = await measure(metric);
      for (const { id } of ROWS) {
        const relevance = relevanceFromDistance(metric, measured.get(id)!);
        expect(relevance).toBeCloseTo(EXPECTED_RELEVANCE[metric][id]!, 6);
      }
    }
  });

  it('every measured l2 relevance lands in [0.2, 1]; only dot off the unit sphere breaches', async () => {
    const byL2 = await measure('l2');
    for (const { id } of ROWS) {
      const relevance = relevanceFromDistance('l2', byL2.get(id)!);
      expect(relevance).toBeGreaterThanOrEqual(0.2);
      expect(relevance).toBeLessThanOrEqual(1);
      expect(isRelevanceInRange(relevance)).toBe(true);
    }

    // The single measured breach in the whole matrix — the case the
    // out-of-range warning exists for, and the reason its cause text is
    // metric-specific (F1).
    const byDot = await measure('dot');
    const breach = relevanceFromDistance('dot', byDot.get('scaled-2x')!);
    expect(breach).toBeCloseTo(1.5, 6);
    expect(isRelevanceInRange(breach)).toBe(false);
  });
});
