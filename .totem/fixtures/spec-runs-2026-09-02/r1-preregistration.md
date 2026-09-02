# R1 pre-registration — written before any relevance label existed

Seat: totem-claude · round: mmnto-ai/totem-strategy#1193 · written 2026-09-02 ~21:45Z, after the re-retrieval harness and the reranker smoke (2 queries) had run and BEFORE `r1-candidates.ndjson` was labelled.

## Units and denominator

- Task-level unit: one `totem spec` retrieval for one recorded query at the index pin (manifest written 2026-09-02T20:48:59Z at `8d5e2691`, gemini-embedding-2-preview 768-d, 5903 chunks).
- Denominator: the 31 issue-anchored runs (30 issue-only + 1 issue+topic mixed, classified by first anchor). The 24 topic-anchored runs are measured beside them as the unanchored class and do not enter the verdict.
- Delivered set per arm: 5 spec-partition items + 3 code-partition items = 8, the production caps.

## Arms

1. `baseline` — the production hybrid order (vector + FTS, RRF k=60), as delivered.
2. `ce-rerank` — the raw candidate pools (vector 60 ∪ FTS ≤60 for spec; 9 ∪ 9 for code) re-scored by `Xenova/bge-reranker-base` (q8, local CPU), top 5 + 3.
3. `query-tasktype` — the production fusion with the query embedded as `RETRIEVAL_QUERY` instead of the production `RETRIEVAL_DOCUMENT`, top 5 + 3.

## Correctness measure

precision@8 = (labelled-relevant items among the 8 delivered) / 8, per query; mean over the 31. Labels: hand-adjudicated per (query, chunk) by Opus legs against a written rubric, blind to which arm delivered the chunk (the candidate file carries `deliveredBy`, which the legs are told to ignore), with a seat spot-check of a sample. Also reported: precision@5 on the spec partition and precision@3 on the code partition.

## Pass / refute conditions (stated now, judged later)

An arm PASSES R1 if ALL of:
- (i) mean precision@8 gain over `baseline` ≥ +0.10 absolute on the 31;
- (ii) paired no-regression on ≥ 24 of 31 queries (per-query precision@8 not lower than baseline);
- (iii) cost: p95 added latency per query ≤ 2000 ms on this machine's CPU with no GPU (local default), with the embedding call for the query-tasktype arm charged to that arm.
Otherwise it is REFUTED on the condition(s) it misses. Score separation (CE score of relevant vs non-relevant, vector relevance distributions) is reported as a diagnostic only, never as the verdict.

## Known before labelling

- The CE arm at the full pool costs ~26–30 s per query on this CPU (2-query smoke), so it is expected to MISS (iii) at the full pool; a reduced-pool variant (rerank only the top-N of the hybrid order) can be derived from the recorded per-item scores and is reported as a separate row with its own cost, but it is not the pre-registered arm.
- The production `lessons` and `sessions` partitions are structurally empty (0 of 55 runs delivered either), so precision is over specs + code only.
