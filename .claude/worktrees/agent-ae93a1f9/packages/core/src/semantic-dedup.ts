import type { Embedder } from './embedders/embedder.js';
import { TotemError } from './errors.js';
import type { LanceStore } from './store/lance-store.js';
import type { ExtractedLesson } from './suspicious-lesson.js';

// ─── Cosine similarity ─────────────────────────────────

/** Cosine similarity between two vectors of equal length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new TotemError(
      'PARSE_FAILED',
      'Cannot compute cosine similarity for vectors of different lengths.',
      'This is an internal error. The embedding dimensions may have changed between runs.',
    );
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Semantic deduplication ─────────────────────────────

/**
 * Remove semantically duplicate lessons by checking against both the LanceDB
 * index and already-accepted candidates in the current batch.
 *
 * Uses embedding cosine similarity with a configurable threshold (default 0.92).
 * Returns only the lessons that are sufficiently novel.
 */
export async function deduplicateLessons(
  candidates: ExtractedLesson[],
  store: LanceStore,
  embedder: Embedder,
  threshold: number = 0.92,
): Promise<{ kept: ExtractedLesson[]; dropped: ExtractedLesson[] }> {
  if (candidates.length === 0) return { kept: [], dropped: [] };

  const kept: ExtractedLesson[] = [];
  const dropped: ExtractedLesson[] = [];
  const batchVectors: number[][] = [];

  for (const candidate of candidates) {
    // Check against existing LanceDB lessons
    let isDbDuplicate = false;
    try {
      const results = await store.search({
        query: candidate.text,
        typeFilter: 'spec',
        maxResults: 1,
      });

      if (results.length > 0 && results[0]!.score >= threshold) {
        isDbDuplicate = true;
      }
    } catch {
      // Empty DB or no table — no existing lessons to dedup against
    }

    if (isDbDuplicate) {
      dropped.push(candidate);
      continue;
    }

    // Check against already-accepted candidates in this batch
    const [candidateVector] = await embedder.embed([candidate.text]);
    let isIntraBatchDuplicate = false;
    for (const batchVec of batchVectors) {
      if (cosineSimilarity(candidateVector!, batchVec) >= threshold) {
        isIntraBatchDuplicate = true;
        break;
      }
    }

    if (isIntraBatchDuplicate) {
      dropped.push(candidate);
    } else {
      kept.push(candidate);
      batchVectors.push(candidateVector!);
    }
  }

  return { kept, dropped };
}
