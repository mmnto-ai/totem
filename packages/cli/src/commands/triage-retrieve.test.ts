import { describe, expect, it } from 'vitest';

import type { LanceStore, SearchResult } from '@mmnto/totem';

import { retrieveContext } from './triage.js';

// ─── retrieveContext lesson delivery (mmnto-ai/totem#2735) ──
//
// The defect this pins: mmnto-ai/totem#431 re-keyed the lesson partition onto
// `type === 'lesson'` but left this retrieval querying the store with
// `typeFilter: 'spec'`, so the pool could not contain a lesson by construction
// and `triage` delivered zero of them to every roadmap.

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

/** A store that answers per `typeFilter` and records every type it was asked for. */
function typedStore(rows: Partial<Record<string, SearchResult[]>>): {
  store: LanceStore;
  typeFilters: string[];
} {
  const typeFilters: string[] = [];
  const store = {
    search: async ({ typeFilter }: { typeFilter: string }): Promise<SearchResult[]> => {
      typeFilters.push(typeFilter);
      return rows[typeFilter] ?? [];
    },
  } as unknown as LanceStore;
  return { store, typeFilters };
}

describe('triage retrieveContext — lessons are their own pool', () => {
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
});
