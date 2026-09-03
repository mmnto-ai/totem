import { describe, expect, it } from 'vitest';

import type { SearchResult } from '../types.js';
import type { LanceStore } from './lance-store.js';
import { searchLessons } from './search-lessons.js';

// The invariant pinned in the package that OWNS the helper, from source: the
// CLI's twin of this test reaches it through core's built dist, so a source
// change here would only fail there after a rebuild (mmnto-ai/totem#2735).

/** A spy store that records the search request and returns one lesson row. */
function spyStore(): { store: LanceStore; requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = [];
  const lesson: SearchResult = {
    content: 'Always validate input at boundaries.',
    contextPrefix: '',
    filePath: '.totem/lessons/lesson-abc.md',
    absoluteFilePath: '.totem/lessons/lesson-abc.md',
    type: 'lesson',
    label: 'Lesson A',
    score: 0.9,
    metadata: {},
  };
  const store = {
    search: async (req: Record<string, unknown>): Promise<SearchResult[]> => {
      requests.push(req);
      return [lesson];
    },
  } as unknown as LanceStore;
  return { store, requests };
}

describe('searchLessons', () => {
  it("asks the store for typeFilter 'lesson' — the one place the type is spelled", async () => {
    const { store, requests } = spyStore();

    await searchLessons(store, 'any query', 10);

    expect(requests).toHaveLength(1);
    expect(requests[0]!['typeFilter']).toBe('lesson');
  });

  it('passes query and maxResults through unchanged', async () => {
    const { store, requests } = spyStore();

    await searchLessons(store, 'lesson trap pattern decision', 3);

    expect(requests[0]!['query']).toBe('lesson trap pattern decision');
    expect(requests[0]!['maxResults']).toBe(3);
  });

  it("returns the store's rows untouched", async () => {
    const { store } = spyStore();

    const results = await searchLessons(store, 'any query', 10);

    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe('lesson');
    expect(results[0]!.label).toBe('Lesson A');
  });
});
