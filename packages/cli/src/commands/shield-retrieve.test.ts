import { describe, expect, it } from 'vitest';

import type { LanceStore, SearchResult } from '@mmnto/totem';

import { retrieveContext } from './shield.js';
import { MAX_SPEC_RESULTS, SPEC_SEARCH_POOL } from './shield-templates.js';

// ─── retrieveContext lesson delivery (mmnto-ai/totem#2735) ──
//
// The defect this pins: mmnto-ai/totem#431 re-keyed the lesson partition onto
// `type === 'lesson'` but left this retrieval querying the store with
// `typeFilter: 'spec'`, so the pool could not contain a lesson by construction
// and `shield` delivered zero of them to every review.

function makeRow(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    content: 'row content',
    contextPrefix: '',
    filePath: 'docs/reference/architecture.md',
    absoluteFilePath: 'docs/reference/architecture.md',
    type: 'spec',
    label: 'Architecture > Overview',
    score: 0.5,
    metadata: {},
    ...overrides,
  };
}

/** A store that answers per `typeFilter` and records every request it received. */
function typedStore(rows: Partial<Record<string, SearchResult[]>>): {
  store: LanceStore;
  typeFilters: string[];
  requests: { typeFilter: string; maxResults: number }[];
} {
  const typeFilters: string[] = [];
  const requests: { typeFilter: string; maxResults: number }[] = [];
  const store = {
    search: async (req: { typeFilter: string; maxResults: number }): Promise<SearchResult[]> => {
      typeFilters.push(req.typeFilter);
      requests.push({ typeFilter: req.typeFilter, maxResults: req.maxResults });
      return rows[req.typeFilter] ?? [];
    },
  } as unknown as LanceStore;
  return { store, typeFilters, requests };
}

describe('shield retrieveContext — lessons are their own pool', () => {
  it('delivers a lesson AND a spec when the store holds one of each', async () => {
    const { store } = typedStore({
      lesson: [makeRow({ type: 'lesson', label: 'Lesson A' })],
      spec: [makeRow({ label: 'Spec A' })],
    });

    const ctx = await retrieveContext('test query', store);

    expect(ctx.lessons.length).toBe(1);
    expect(ctx.lessons[0]!.label).toBe('Lesson A');
    expect(ctx.specs.length).toBe(1);
    expect(ctx.specs[0]!.label).toBe('Spec A');
  });

  it("asks the store for typeFilter 'lesson'", async () => {
    const { store, typeFilters } = typedStore({
      lesson: [makeRow({ type: 'lesson' })],
      spec: [makeRow()],
    });

    await retrieveContext('test query', store);

    expect(typeFilters).toContain('lesson');
    expect(typeFilters).toContain('spec');
  });

  it('delivers no lessons when the store holds none, without failing', async () => {
    const { store } = typedStore({ spec: [makeRow()] });

    const ctx = await retrieveContext('test query', store);

    expect(ctx.lessons).toEqual([]);
    expect(ctx.specs.length).toBe(1);
  });

  // Request identity is the only thing that CAN pin "the specs delivered are
  // unchanged" against a real store: on the hybrid path the requested width is
  // the RRF fusion window (`packages/core/src/store/lance-search.ts` fetches
  // `maxResults * HYBRID_OVERFETCH_FACTOR` per leg), so a narrower request
  // changes WHICH rows survive fusion, not merely how many are cut.
  it('asks for the spec pool at exactly SPEC_SEARCH_POOL, unchanged by this slice', async () => {
    const { store, requests } = typedStore({ spec: [makeRow()] });

    await retrieveContext('test query', store);

    const specRequests = requests.filter((r) => r.typeFilter === 'spec');
    expect(specRequests).toEqual([{ typeFilter: 'spec', maxResults: SPEC_SEARCH_POOL }]);
  });

  it('delivers the top-MAX_SPEC_RESULTS specs by score, in score order', async () => {
    const scores = [0.9, 0.8, 0.7, 0.6, 0.5];
    expect(scores.length).toBeGreaterThan(MAX_SPEC_RESULTS);
    const { store } = typedStore({
      spec: scores.map((score, i) => makeRow({ label: `Spec ${i}`, score })),
    });

    const ctx = await retrieveContext('test query', store);

    expect(ctx.specs.length).toBe(MAX_SPEC_RESULTS);
    expect(ctx.specs.map((s) => s.score)).toEqual(scores.slice(0, MAX_SPEC_RESULTS));
  });
});
