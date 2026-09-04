# R4 — the calibrated-floor arm (mmnto-ai/totem#2727; synthesis § 2.1 falsifier, § 9.8)

**Status:** pre-registered before any run. Commit 1 of this directory carries this document and the script unexecuted; commit 2 carries the run record. Nothing in the script was tuned against the labels after this text was written.

**Question.** Does a relevance floor exist on this profile that withholds at least one delivered item across the 55 recorded `totem spec` queries at the pin without dropping mean p@8 on the 31 issue-anchored queries below the R1 baseline (0.3952)?

**Profile.** gemini-embedding-2-preview, 768-d; stored and query vectors unit-norm; LanceDB `_distance` = squared L2 (R1's measurement); relevance = 1/(1+_distance) ∈ [0.2, 1].

**Inputs (read-only, from `../spec-runs-2026-09-02/` at pin `14daff4d`).** `r1-rerank.ndjson` — per query the baseline delivered set (`arms.baseline.specs`, `arms.baseline.code`, by chunkId) and the fused candidate pool (`poolItems.spec`, `poolItems.code`: chunkId, vectorRank, ftsRank, relevance). `r1-labels-part{0,1,2}.ndjson` — label 0/1/2 per (query id, chunkId); 2 = relevant, the R1 scorer's definition. `r1-retrieval.ndjson` — `raw.legs.<partition>.worstRelevance`, the exactness bound. `r1-score.json` — the baseline figures the control must reproduce.

**Control (before any arm is scored).** Re-derive the baseline mean p@8, p@5-spec and p@3-code on the 31 issue-anchored queries from `arms.baseline` + labels with the R1 scorer's `precision()` (hit = label 2; denominator = delivered count; an unlabelled delivered item is a non-hit) and assert equality with `r1-score.json` → `issueAnchored.arms.baseline` to four decimals. A mismatch is an apparatus fault: the run stops and reports.

**Arms (deterministic; no network, no index, no LLM).**
- **A-post** — post-fusion, the shape the MCP `min_relevance` override implements today: from the delivered baseline set, withhold items with `relevance < τ`; an item with no relevance (FTS-only) is exempt.
- **A-pre** — pre-fusion, the shape LanceDB's `VectorQuery.distanceRange` implements: per query and partition, remove from the VECTOR leg every pool item whose relevance < τ (its `vectorRank` becomes null; an `ftsRank` survives), compact the surviving vector ranks to 1..n in their original order, recompute RRF with k = 60 over the pool (`(vectorRank ? 1/(60+vectorRank) : 0) + (ftsRank ? 1/(60+ftsRank) : 0)`), sort descending, take the top 5 specs and top 3 code — the R1 scorer's `reducedPoolVariant` arithmetic without its cross-encoder step.
- **Candidate τ (both A shapes):** the sweep 0.500, 0.505, …, 0.750, plus two calibrated points from the borderline set (the labelled delivered baseline items over all 55 queries): τ_cal2 = (minimum relevance over label-2 items) − 0.0005, which withholds no relevant delivered item by construction; τ_cal1 = the same over label ≥ 1.
- **B (distribution-relative; A-pre shape only):** per query, τ_q = best_q − δ for δ ∈ {0.02, 0.05, 0.10, 0.15}, and τ_q = best_q × (1 − ρ) for ρ ∈ {0.05, 0.10, 0.15, 0.20}, where best_q = the query's best vector relevance across its partitions' pools.

**Scored per candidate.** Items withheld over the 55 (count, and by label 0 / 1 / 2 / unlabelled) and over the 31; queries left with no delivered item at all (a refusal): count; mean p@8, p@5-spec, p@3-code on the 31 with the delivered denominator, and their deltas against the baseline; the same three on the 24 topic queries beside, not scored against the falsifier.

**Falsifier (verbatim from the synthesis § 2.1).** "a floor that withholds ≥ 1 item on the 55 at the pin without dropping p@8". A candidate PASSES iff withheld ≥ 1 over the 55 AND mean p@8 on the 31 ≥ 0.3952. The arm PASSES iff at least one A-pre candidate passes. The record names every passing candidate and, among candidates withholding no label-2 item, the one that withholds the most.

**Exactness bound.** A-pre is exact for τ ≥ the partition's recorded `worstRelevance` (the recorded vector leg is the full 60-hit window; a floor below the 60th hit could admit unrecorded backfill). A candidate below that bound in any partition is flagged `exactness: lower-bound`.

**Limits stated up front.** One profile; labels only on the delivered sets and pools R1 labelled (814 pairs; an unlabelled item is a non-hit, as in R1); the pool is the recorded window; no re-embedding; topic queries unscored against the falsifier; the arm measures the floor as a withholding device, not the refusal envelope's wording.
