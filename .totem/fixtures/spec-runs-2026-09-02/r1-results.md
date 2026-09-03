# R1 results — judged against `r1-preregistration.md` (mmnto-ai/totem-strategy#1193)

Labels: 814 (anchor, chunk) pairs over 55 queries — the union of every arm's delivered set — labelled MECHANICALLY arm-blind (`scripts/r1-blind-candidates.mjs` strips the arm provenance and seed-shuffles each query's candidates; every one of the 814 label rows joins to the blind order, and 0 of 55 queries kept the unblinded order) by three Opus legs under `r1-label-rubric.md` (2 = relevant, 1 = marginal, 0 = not): 260 / 141 / 413. Every item of the three pre-registered arms is labelled; the derived reduced-pool variants deliver items outside the union, which count as misses, so their precision is a LOWER bound and their (i)/(ii) conditions are indeterminate. Scorer: `scripts/r1-score.mjs` → `r1-score.json`; diagnostics: `scripts/r1-diagnostics.mjs` → `r1-diagnostics.json`.

## The 31 issue-anchored runs (the denominator)

| arm | mean p@8 | p@5 spec | p@3 code | gain vs baseline | no-regression | improved / regressed | added latency p95 on the 31 | verdict |
|---|---|---|---|---|---|---|---|---|
| baseline (production hybrid) | 0.395 | 0.110 | 0.871 | — | 31/31 | — | 0 ms | — |
| ce-rerank (bge-reranker-base, full pool, mean 91.5 pairs) | 0.323 | 0.077 | 0.731 | −0.073 | 15/31 | 7 / 16 | 65,448 ms measured (32,302 ms over all 55) | REFUTED on (i), (ii), (iii) |
| query-tasktype (RETRIEVAL_QUERY embedding) | 0.391 | 0.103 | 0.871 | −0.004 | 29/31 | 1 / 2 | 622 ms measured (616 ms over all 55) | REFUTED on (i); (ii) and (iii) met |
| ce-top10 (derived; 75 of 248 delivered items unlabelled) | ≥ 0.327 | ≥ 0.103 | ≥ 0.699 | lower bound −0.069 | ≥ 16/31 | — | ~5.4 s mean, derived from 268.7 ms/pair × 20 pairs | not pre-registered; (i)/(ii) indeterminate; refuted on (iii) |
| ce-top20 (derived; 76 of 248 unlabelled) | ≥ 0.335 | ≥ 0.097 | ≥ 0.731 | lower bound −0.061 | ≥ 16/31 | — | ~9.4 s mean / ~10.2 s max, derived (34.8 pairs) | not pre-registered; (i)/(ii) indeterminate; refuted on (iii) |

Conditions: (i) gain ≥ +0.10 · (ii) no-regression ≥ 24/31 · (iii) p95 added latency ≤ 2000 ms on CPU, with the p95 taken over the pre-registered denominator (the 31). The all-55 figures are reported beside for the record; no verdict differs between the two.

## The 24 topic-anchored runs (beside, not in the verdict)

baseline 0.375 · ce-rerank 0.339 (17/24 no-regression) · query-tasktype 0.370 (23/24) · ce-top10 ≥ 0.349 · ce-top20 ≥ 0.344.

## Diagnostics (never the verdict; `r1-diagnostics.json`)

- Score separation over the labelled union of delivered items (one entry per query-chunk; n relevant / not = 260 / 413 for the cross-encoder score, 209 / 318 for the vector relevance — only items that carried a vector leg have one): cross-encoder AUC(relevant > not) = **0.629** (mean 0.05 vs −1.75, median 0.73 vs −0.82); the production vector relevance `1/(1+d)` AUC = **0.846** (mean 0.660 vs 0.594, median 0.665 vs 0.599). On this corpus the embedding similarity discriminates better than the cross-encoder, which is trained on passage retrieval and sees code chunks truncated at 512 tokens per pair.
- Where precision is lost: over the union, `code` chunks are 217 relevant / 22 not (78 % relevant); `spec` chunks are 43 relevant / 391 not (8 %). The baseline delivered ≥ 1 relevant code item on 31/31 queries and ≥ 1 relevant spec item on only 14/31. The spec partition's sources for the 31: `docs/wiki` 130 of 155 items, `docs/reference` 16, `.gemini/skills` 7, `docs/manual` 2 — roadmap tables, CLI-reference preambles and wiki sections, while the 1881 `lesson` chunks never enter the pool (the `partitionLessons` defect) and `session_log` has no chunks.
- Delivered-set overlap: baseline ~ ce-rerank mean Jaccard 0.124 (identical on 0/55); baseline ~ query-tasktype 0.886 (identical on 29/55).
- Cost of the production path itself at the pin: mean 320 ms / p95 408 ms per retrieval, 3 embed calls per query. The cross-encoder's per-query cost on the 31: p50 25.6 s, p95 65.4 s, max 72.9 s.

## Limits (including the pre-merge falsification leg's findings, folded 2026-09-03)

- **The cross-encoder scored the RAW query while the embedder saw the EXPANDED one** (`r1-rerank.mjs`: `ceQuery = q.raw`; `expandSpecQuery` appends test-infrastructure keywords when the query mentions testing). On the 10 issue-anchored queries where the expansion fired the CE arm's gain is −0.150; on the other 21 it is −0.036 (weighted −0.073). Two-thirds of the arm's loss sits on that third of the denominator, so part of the refutation is the asymmetry, not the model — but −0.036 on the symmetric 21 is still far from the +0.10 floor, so the pre-registered verdict does not depend on it. The symmetric re-run is a stated follow-up, not done here.
- **Chunk identity in the raw legs is (filePath, label, type), not a row id.** 20 keys in the index hold 105 rows with differing content, so the runner's resolution was ambiguous 869 times: 4 of the 440 baseline delivered items resolved to a sibling chunk's TEXT (all in `docs/wiki/cli-reference.md`, all in the spec partition; two were labelled relevant), a bounded effect ≤ 0.008 on mean p@8; and 229 vector-leg + 82 FTS-leg rows were collapsed out of the CE pools. Consequently the derived `ce-topN` variants rerank a reconstructed hybrid order that reproduces production's top-5 spec on only 9/55 queries (55/55 for code; 8/8 exact on collision-free legs, so the RRF formula itself is faithful). Cure for a re-run: record the row `id` in the legs.
- One labeller per pair (no inter-rater measure; the legs split queries, not pairs); labels are LLM-made under a rubric with a seat spot-check of 6, not human; thin bare-slug topic anchors were judged on the reading the legs recorded; the reduced-pool variants are derived from recorded per-item scores, not timed runs; one reranker model at one quantization; the query-tasktype arm keeps the production FTS leg and only re-embeds the query.
