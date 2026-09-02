# R1 results — judged against `r1-preregistration.md` (mmnto-ai/totem-strategy#1193)

Labels: 814 (anchor, chunk) pairs over 55 queries, the union of every arm's delivered set, labelled arm-blind by three Opus legs under `r1-label-rubric.md` (2 = relevant, 1 = marginal, 0 = not): 260 / 141 / 413. Every item of the three pre-registered arms is labelled (0 missing lookups); the derived reduced-pool variants deliver some items outside the union, which count as misses, so their precision is a LOWER bound. Scorer: `scripts/r1-score.mjs` → `r1-score.json`.

## The 31 issue-anchored runs (the denominator)

| arm | mean p@8 | p@5 spec | p@3 code | gain vs baseline | no-regression | improved / regressed | added latency p95 | verdict |
|---|---|---|---|---|---|---|---|---|
| baseline (production hybrid) | 0.395 | 0.110 | 0.871 | — | 31/31 | — | 0 ms | — |
| ce-rerank (bge-reranker-base, full pool, mean 91.5 pairs) | 0.323 | 0.077 | 0.731 | −0.073 | 15/31 | 7 / 16 | 32,302 ms (measured) | REFUTED on (i), (ii), (iii) |
| query-tasktype (RETRIEVAL_QUERY embedding) | 0.391 | 0.103 | 0.871 | −0.004 | 29/31 | 1 / 2 | 616 ms (measured) | REFUTED on (i); (ii) and (iii) met |
| ce-top10 (derived, lower bound) | 0.327 | 0.103 | 0.699 | −0.069 | 16/31 | 4 / 15 | ~3.5 s (derived from 269 ms/pair) | not pre-registered; refuted on (i), (ii), (iii) |
| ce-top20 (derived, lower bound) | 0.335 | 0.097 | 0.731 | −0.061 | 16/31 | 7 / 15 | ~6.2 s (derived) | not pre-registered; refuted |

Conditions: (i) gain ≥ +0.10 · (ii) no-regression ≥ 24/31 · (iii) p95 added latency ≤ 2000 ms on CPU.

## The 24 topic-anchored runs (beside, not in the verdict)

baseline 0.375 · ce-rerank 0.339 (17/24 no-regression) · query-tasktype 0.370 (23/24) · ce-top10 0.349 · ce-top20 0.344.

## Diagnostics (never the verdict)

- Score separation over the labelled union: cross-encoder score AUC(relevant > not) = **0.629** (mean 0.05 vs −1.75); the production vector relevance `1/(1+d)` AUC = **0.846** (mean 0.660 vs 0.594, median 0.665 vs 0.599). On this corpus the embedding similarity discriminates better than the cross-encoder, which is trained on passage retrieval and sees code chunks truncated at 512 tokens per pair.
- Where precision is lost: over the union, `code` chunks are 217 relevant / 22 not (78 % relevant); `spec` chunks are 43 relevant / 391 not (8 %). The baseline delivered ≥ 1 relevant code item on 31/31 queries and ≥ 1 relevant spec item on only 14/31. The spec partition's sources for the 31: `docs/wiki` 130 of 155 items, `docs/reference` 16, `.gemini/skills` 7, `docs/manual` 2 — roadmap tables, CLI-reference preambles and wiki sections, while the 1881 `lesson` chunks never enter the pool (the `partitionLessons` defect) and `session_log` has no chunks.
- Delivered-set overlap: baseline ~ ce-rerank mean Jaccard 0.124 (identical on 0/55); baseline ~ query-tasktype 0.886 (identical on 29/55).
- Cost of the production path itself at the pin: mean 320 ms / p95 408 ms per retrieval, 3 embed calls per query.

## Limits

One labeller per pair (no inter-rater measure; the three legs split queries, not pairs); labels are LLM-made under a rubric with a seat spot-check, not human; thin bare-slug topic anchors were judged on the reading the legs recorded; the reduced-pool variants are derived from recorded per-item scores, not timed runs; one reranker model at one quantization; the query-tasktype arm keeps the production FTS leg and only re-embeds the query.
