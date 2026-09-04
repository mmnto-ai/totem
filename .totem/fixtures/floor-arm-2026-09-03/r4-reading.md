# R4 — the owner's reading of the run record (totem-claude, 2026-09-04)

The record is `r4-summary.md` / `r4-floor-arm.json`, generated unedited by `scripts/r4-floor-arm.mjs` from the pre-registration in commit 1. This document is the seat's reading of it; it changes no number and amends no verdict rule after the data.

## 1. Verdict by the letter

**R4 FAILS.** The pre-registration made A-pre the deciding shape ("the arm PASSES iff at least one A-pre candidate passes"), and no A-pre candidate holds mean p@8 on the 31 at or above 0.3952 while withholding at least one item over the 55. Forty-four candidates pass, every one of them A-post.

## 2. Apparatus finding: the A-pre comparator is off before any floor acts

At τ = 0.500 — below the pool's minimum recorded relevance of 0.5022, so the floor removes nothing anywhere — A-pre reads mean p@8 0.3911 (Δ −0.0040) with 31 baseline-delivered items already absent from its delivered set. The recorded pool re-fuses (RRF, k = 60) to the production delivered set in 65 of 110 (query, partition) pairs; 417 of 440 delivered items carry a `score` equal to the pool RRF; 107 of 5,030 pool items carry a vector or FTS rank that differs from the raw legs in `r1-retrieval.ndjson` when joined on filePath + label. So `poolItems` in `r1-rerank.ndjson` is not an exact reconstruction of the production fusion input, and every A-pre row starts 0.0040 below the threshold for a reason that is not the floor.

The pre-registration's control reproduced the A-post baseline (0.3952 / 0.1097 / 0.8710, exact) and did not require the A-pre no-floor point to reproduce it. That is the apparatus fault. Its consequence is stated, not repaired: **A-pre is undetermined on this fixture, not refuted.** The verdict rule stands as written, because a rule amended after the data is no pre-registration; the honest A-pre arm is a live-index run (`VectorQuery.distanceRange` on the vector leg at the pin, scored against the production delivered set from the same run) and is filed as its own pre-registration (R5), not re-run here. The same 65-of-110 discrepancy belongs on the R1 record as a note on the pool export.

## 3. What the record does establish — the shipped shape

A-post is the shape the product implements today: the MCP `min_relevance` override and the configured `searchRelevanceFloor` compare against each delivered hit's vector-leg relevance, and an FTS-only hit is exempt. On that shape:

- The shipped default of 0.25 withholds nothing. The lowest delivered relevance over the 55 is 0.5022; the first item is withheld at τ = 0.510.
- **τ_cal2 = 0.5287** — the borderline-set calibration the synthesis borrowed (the lowest relevance of any label-2 delivered item, minus 0.0005) — withholds 11 delivered items over the 55 (10 label-0, 1 label-1, 0 label-2), none on the 31, causes no refusal, and leaves every scored figure unchanged. It satisfies the synthesis's falsifier as worded, non-trivially, on the shape that ships.
- Above τ ≈ 0.56 the table's p@8 rises to 0.80 while withholding dozens of label-2 items. That is the delivered-denominator definition rewarding a shrinking set, not a better floor: "without dropping p@8" is a weak clause against withholding. The reading that survives is the zero-label-2 boundary, τ_cal2, not the p@8 maximum.

## 4. Consequence for the ruling

The operator's ruling was to run the arm first and code the branch it proves. The synthesis (§ 8.2.3, § 9.8) names the branches: a calibrated per-profile floor with a calibration procedure and a profile record, or the default removed with `no_useful_hits` kept for the explicit `min_relevance` override only. The record proves:

1. **The default is not a number.** A default no index reaches is a mechanism claim without a mechanism, and a calibrated value is repo-local by construction (this repo's 0.5287 is a property of this corpus, these labels, this embedder). So the DEFAULT floor is removed: `searchRelevanceFloor` becomes an optional, un-defaulted config value; with it unset there is no floor — no `no_useful_hits` by floor, no spec refusal by floor — and the explicit `min_relevance` override keeps its meaning.
2. **The calibration procedure is documented and this repo dogfoods it.** The wiki states what the floor is measured against (vector relevance = 1/(1 + squared L2) on unit vectors, range [0.2, 1], observed [0.50, 0.77] on this profile), that no default is shipped and why, and the τ_cal2 recipe with this record as the worked example; this repo's `totem.config.ts` sets `searchRelevanceFloor` to 0.5287 with the citation, so the envelope and the refusal arms have a reachable floor here.
3. **The lesson pool honours the configured floor** (the ruled lesson-gate half): the same per-hit comparison, the same FTS-only exemption; with no floor configured, lessons pass ungated as today.

That code slice is the next PR under mmnto-ai/totem#2727. This PR is the record.

## 5. Disclosures carried from the run

- "Withheld" for A-pre was implemented as: a baseline-delivered chunkId absent from the candidate's delivered set. It therefore folds in the fusion-difference loss of § 2; that is why A-pre is undetermined rather than merely failing.
- After a pre-fusion removal an item left in neither leg (RRF 0) is dropped as a candidate; this is a reading of the text and is immaterial below τ ≈ 0.56.
- A-post rows are marked `exact` because A-post never re-queries the index; the backfill bound applies to the pre-fusion window only.
- `session_log` contributes no pool (vector count 0 on all 55 rows), so the exactness bound was evaluated over spec and code.
- Four baseline spec lists carry a duplicated chunkId (an R1 export artifact); R1's own 0.3952 counts both entries, and the withheld rule cannot inflate a count from it.
- Deltas are rounded from unrounded means and may differ from the rounded difference by 0.0001.

## 6. Follow-ups

- R5: the live-index A-pre arm (`distanceRange` at the pin), pre-registered before it runs.
- A note on the R1 record: the pool export reproduces production fusion in 65 of 110 pairs.
