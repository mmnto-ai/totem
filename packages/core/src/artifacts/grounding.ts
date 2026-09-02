/**
 * Grounding-bundle assembly (mmnto-ai/totem#2101, strategy#474 slice 2).
 *
 * The bundle is the per-item provenance record for everything the
 * deterministic layer DELIVERED into a run's prompt: each item names what it
 * is (`sourceType` + `filePath` + optional `sourceRepo`), what it contained
 * (`contentHash` — identity, never bytes), and HOW it was obtained
 * (`provenance` class). The first cut wraps similarity retrieval honestly as
 * `similarity-only`; structural resolvers (mmnto-ai/totem#344/#375) graduate items to
 * `structurally-verified` by supplying them explicitly — this builder can
 * never upgrade a class on its own (honest-absent: nothing upgrades
 * provenance silently).
 *
 * Assembly is caller-side (the deterministic layer) — providers stay dumb
 * pipes. The bundle is what `grounding.hash` attests: the DELIVERED items with
 * their measured relevance (mmnto-ai/totem#2700). Items are canonically sorted
 * here BECAUSE the hash is order-significant for arrays and retrieval order is
 * score-dependent — the sort is what makes two runs over the same delivered
 * set hash alike.
 */

import { calculateDeterministicHash } from './hash.js';
import {
  type GroundingBundle,
  type GroundingItem,
  PROVENANCE_SIMILARITY_ONLY,
  PROVENANCE_UNGROUNDED,
} from './schema.js';

/**
 * One retrieved evidence item as the caller holds it — the `result` shape is
 * the identity-relevant subset of `SearchResult`, kept structural so callers
 * and tests don't need a full store hit to build one.
 */
export interface GroundingSourceItem {
  /** Retrieval partition the item entered the prompt under (`spec` | `session_log` | `code` | `lesson`). */
  sourceType: string;
  result: {
    content: string;
    filePath: string;
    /** Linked-index name for cross-repo hits; absent = the run's own repo (strategy review F1 on mmnto-ai/totem#2101). */
    sourceRepo?: string | undefined;
    /**
     * The vector-leg relevance the hit was delivered with, `1 / (1 + distance)`
     * (mmnto-ai/totem#2700). Absent when the hit had no vector leg (FTS-only) —
     * absence is the honest disclosure, never a zero.
     */
    relevance?: number | undefined;
  };
}

/**
 * Locale-independent string compare (localeCompare is environment-dependent
 * and would let two machines disagree on the canonical order — and therefore
 * the hash — of the same bundle).
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical item order: (sourceType, sourceRepo, filePath, contentHash). */
function compareItems(a: GroundingItem, b: GroundingItem): number {
  return (
    compareStrings(a.sourceType, b.sourceType) ||
    compareStrings(a.sourceRepo ?? '', b.sourceRepo ?? '') ||
    compareStrings(a.filePath, b.filePath) ||
    compareStrings(a.contentHash, b.contentHash)
  );
}

/**
 * Map retrieved items into a canonical grounding bundle. Every input item is
 * included — duplicates are delivery records, not noise (the bundle records
 * what entered the prompt, and a snippet delivered twice was delivered
 * twice). All items are classed `similarity-only`: this is the first-cut
 * wrapper around the existing retrieval, and the ONLY class this builder can
 * emit by construction.
 *
 * A hit's vector-leg `relevance` is carried onto its item ONLY when it is a
 * finite number (mmnto-ai/totem#2700) — an FTS-only hit carries none, and the
 * absence is the disclosure. The value rides the item through the canonical
 * sort, so no index correspondence with the input array is ever needed. Range
 * ([0, 1]) is the schema's to enforce, not this builder's.
 */
export function buildGroundingBundle(items: GroundingSourceItem[]): GroundingBundle {
  const mapped: GroundingItem[] = items.map(({ sourceType, result }) => ({
    provenance: PROVENANCE_SIMILARITY_ONLY,
    contentHash: calculateDeterministicHash(result.content),
    sourceType,
    filePath: result.filePath,
    ...(result.sourceRepo !== undefined ? { sourceRepo: result.sourceRepo } : {}),
    ...(typeof result.relevance === 'number' && Number.isFinite(result.relevance)
      ? { relevance: result.relevance }
      : {}),
  }));
  mapped.sort(compareItems);
  return { items: mapped };
}

/**
 * Derive the artifact's `provenanceSummary` from the bundle — never asserted
 * wholesale (derive-or-couple: a stored summary is a mirror that can drift
 * from `items`). Sorted class-count string (`similarity-only:14`,
 * `compiled-rule:1,similarity-only:2`) so the eval harness can threshold on
 * it deterministically; zero items → `'ungrounded'` (abstention named, not
 * silent — Tenet 14 honest-absent).
 */
export function summarizeProvenance(bundle: GroundingBundle): string {
  if (bundle.items.length === 0) return PROVENANCE_UNGROUNDED;
  const counts = new Map<string, number>();
  for (const item of bundle.items) {
    counts.set(item.provenance, (counts.get(item.provenance) ?? 0) + 1);
  }
  return (
    [...counts.keys()]
      .sort(compareStrings)
      // Non-null assertion: every key comes from the same map's own key set
      // (Greptile R1 on mmnto-ai/totem#2122 — a future logic change must fail
      // the type check, not silently render `class:undefined`).
      .map((cls) => `${cls}:${counts.get(cls)!}`)
      .join(',')
  );
}
