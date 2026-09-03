import type { SearchResult } from '../types.js';
import type { LanceStore } from './lance-store.js';

/**
 * Ask the store for lessons — the ONE place the `lesson` content type is
 * spelled for retrieval (mmnto-ai/totem#2735).
 *
 * Every lesson retrieval in the CLI and in core routes through here. The defect
 * it repairs: mmnto-ai/totem#431 re-keyed the old partition helper onto
 * `type === 'lesson'` but left its callers querying the store with
 * `typeFilter: 'spec'`, so the partitioned pool could not contain a lesson by
 * construction and every command delivered zero of them. A single spelling
 * makes that class of drift a one-line regression instead of a silent one.
 *
 * Pure pass-through: `query` and `maxResults` reach the store unchanged, and
 * nothing is cached.
 */
export async function searchLessons(
  store: LanceStore,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  return store.search({ query, typeFilter: 'lesson', maxResults });
}
