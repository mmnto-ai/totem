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
 * pipes. The bundle is what `grounding.hash` attests, so it must be a pure
 * function of the logical item set: items are canonically sorted here because
 * retrieval order is score-dependent and `calculateDeterministicHash` is
 * order-significant for arrays.
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
 */
export function buildGroundingBundle(items: GroundingSourceItem[]): GroundingBundle {
  const mapped: GroundingItem[] = items.map(({ sourceType, result }) => ({
    provenance: PROVENANCE_SIMILARITY_ONLY,
    contentHash: calculateDeterministicHash(result.content),
    sourceType,
    filePath: result.filePath,
    ...(result.sourceRepo !== undefined ? { sourceRepo: result.sourceRepo } : {}),
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
  return [...counts.keys()]
    .sort(compareStrings)
    .map((cls) => `${cls}:${counts.get(cls)}`)
    .join(',');
}
