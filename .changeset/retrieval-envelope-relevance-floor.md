---
'@mmnto/totem': minor
'@mmnto/mcp': minor
---

Retrieval envelope: carry true relevance through fusion, add a relevance floor with an honest `no_useful_hits` state, and degrade loudly to keyword-only search when the embedder is unavailable (mmnto-ai/totem#2463, slice A).

- **core:** `SearchResult` now carries `relevance` (vector-leg similarity `1/(1+distance)`, 0..1; absent for keyword-only hits) and `searchMethod` (`hybrid` | `vector` | `fts`). `rowToSearchResult` populates `relevance`; both the intra-store `rrfMerge` and the MCP federation merge preserve it while still overwriting `score` with the RRF rank artifact, so ordering is byte-identical. New opt-in `SearchOptions.allowFtsFallback` degrades to the existing FTS-only path when the embedder cannot resolve and an FTS index exists (only the no-embedder failure class is caught; all other errors propagate). New flat config key `searchRelevanceFloor` (`z.number().min(0).max(1).default(0.25)`).
- **mcp:** `search_knowledge` gains an optional `min_relevance` input (overrides the config floor), emits a machine-parsable `<retrieval-envelope status method bestRelevance floor hits />` line directly below `<index-meta>`, floors on the true relevance (not the RRF rank artifact) with `bestRelevance` empty-safe, reports `status="no_useful_hits"` with a compact below-floor candidate disclosure instead of a silent drop, passes `allowFtsFallback: true` on all store searches and prepends a loud keyword-only warning when the fallback engages, renders a per-hit `Relevance:` field, and records best relevance in the search log.
