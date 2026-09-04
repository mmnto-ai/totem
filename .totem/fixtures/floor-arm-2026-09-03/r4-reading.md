# R4 — the owner's reading of the run record (v3, totem-claude, 2026-09-04)

The record is `r4-summary.md` / `r4-floor-arm.json`, generated unedited by `scripts/r4-floor-arm.mjs` from the pre-registration in commit 1. This document is the seat's reading of it; it changes no number and amends no verdict rule after the data.

**History.** v1 (`0c656720`) claimed the A-post shape "ships"; the falsification leg refuted that at source. v2 (`e69d77f4`) corrected it; a re-armed leg then found the duplicate-chunk artifact stated in the wrong direction, an unsourced figure, and a missing exactness caveat. v3 folds those. The generated record and the frozen pre-registration are unchanged throughout.

## 1. Verdict by the letter

**R4 FAILS.** The pre-registration made A-pre the deciding shape ("the arm PASSES iff at least one A-pre candidate passes"), and no A-pre candidate holds mean p@8 on the 31 at or above 0.3952 while withholding at least one item over the 55. Forty-four candidates pass, every one of them A-post.

## 2. What the product implements — corrected

Both shipped floors are whole-run gates on the BEST vector-leg relevance of one retrieval (`bestRelevance = max` over the hits that carry one). The MCP `search_knowledge` tool, when `bestRelevance < floor` (`packages/mcp/src/tools/search-knowledge.ts:860`): with no floor-exempt hit it answers `status="no_useful_hits"` with zero hits and the below-floor candidates disclosed; with exempt (keyword-only) hits present it answers `status="ok"` and returns only those. `totem spec` refuses an unanchored free-text run that is not `--raw` when `bestRelevance < floor && floorExempt === 0` (`packages/cli/src/commands/spec.ts:717`, gated at `:993`); issue-anchored and mixed runs never enter that branch, so the gate never runs on the 31 queries the falsifier scores. No shipped path withholds a single sub-floor hit while keeping its siblings.

The pre-registration's provenance sentence for A-post ("the shape the MCP `min_relevance` override implements today") is therefore false, and the generated summary's A-post heading repeats it. A-post is a MODEL of per-item post-fusion withholding that ships nowhere; the frozen text is left as written and corrected here.

## 3. What the record establishes, restated

- **The shipped gate.** On this fixture the lowest best-relevance over delivered specs and code is 0.559 (0.5687 among the 30 refusal-eligible runs, those with no floor-exempt hit). No configured value below 0.559 fires on any of the 55 queries: the 0.25 default never fired and 0.5287 would not either. The first refusal appears above 0.5687 and refuses one whole topic run; between 0.5687 and 0.6379 that one topic run is the only refusal; from about 0.638 the MCP gate would also answer `no_useful_hits` on an issue-anchored retrieval (the next-lowest eligible run, best-relevance 0.6379, is issue-anchored). The default is not a number.
- **A-post, the per-item model.** τ_cal2 = 0.5287 (the lowest relevance of any label-2 delivered item, minus 0.0005) withholds 11 of 440 delivered items — 10 label-0, 1 label-1, 0 label-2 — none on the 31; all eleven sit on topic queries, so the 31's figures are unchanged while the topic-24's move (p@8 0.375 → 0.4154). That rise, and the rise of p@8 above τ ≈ 0.56 while label-2 items are withheld, is the delivered-denominator artifact: the definition rewards a shrinking set. The lowest DELIVERED relevance is 0.5100 (v1's 0.5022 was the pool minimum); the first withholding is at τ = 0.510. These are properties of the model, not of any mechanism in the product.
- **A-pre, the pre-fusion model.** Undetermined against the production baseline: the recorded pool re-fuses (RRF, k = 60, raw ranks) to the production delivered SET in 81 of 110 (query, partition) pairs (65 as ordered lists; precision itself differs on 4 of the 110), and the no-floor point sits at 0.3911 before any floor acts. Against its OWN no-floor point — a post-hoc comparator, not the pre-registered one — the arm would pass for τ in [0.510, 0.560] and fail from 0.565; τ = 0.540 withholds 13 items, none label-2, p@8 unchanged, no refusal. Every one of those rows carries `exactness: lower-bound` in the record (the first exact A-pre τ is 0.700), so the observation is bounded by the recorded 60-hit window. That is evidence the live `distanceRange` arm (R5) is worth running, not a verdict.
- **Duplicates.** Four baseline spec lists carry a duplicated chunkId. They are DISTINCT delivered chunks (distinct `contentHash`, relevances 0.5899–0.6633) that the R1 export collapsed onto one id — chunkId is a function of (filePath, label) across the corpus, and the same heading draws different chunkIds across rows (51 clashes). Because the script's kept-set is keyed by chunkId while withholding is entry-wise, the count UNDER-counts once a pair straddles the floor: onset τ = 0.600; at τ = 0.655 the entry-level count is 301 where the run commit reported 299 (297 by distinct chunkId). τ_cal2 is unaffected (11 either way).

## 4. Consequence for the ruling — corrected

The synthesis (§ 8.2.3, § 9.8) binds the owed calibrated-floor arm to `distanceRange`; nothing in this record discharges it. What the record proves is narrower: the shipped gate's default is unreachable on this profile, and so is any value below a repo's own measured best-relevance floor. So the second branch applies to the DEFAULT only (prescriptive here; the code slice lands it — at this record's commit the schema default 0.25 still stands):

1. `searchRelevanceFloor` loses its default. Unset means no floor: no `no_useful_hits` by floor, no spec refusal by floor; the per-call `min_relevance` override keeps its meaning.
2. The docs say what the gate compares — a retrieval's best relevance, whole-run, never per item — the measured range on this profile, and how a repo picks a value (record its runs, note the best-relevance of the weakest run it wants kept, set the floor below that).
3. This repo sets NO value. 0.5287 fires on nothing; a value in (0.5687, 0.6379] refuses one weak topic run; from about 0.638 the MCP gate withholds an issue-anchored retrieval too.
4. The lesson pool is NOT coupled to the floor. The pinned fixture predates the lesson partition (production.lessons is empty on 55 of 55 rows) and carries no lesson relevance; the figure comes from the mmnto-ai/totem#2727 comment of 2026-09-03T22:20Z, which read the post-mmnto-ai/totem#2750 artifact: 10 of 10 lesson slots filled at relevances around 0.34. Any value that makes the refusal gate reachable would zero that pool. A lesson gate needs its own measurement against lesson relevances.
5. Lessons never ground a run — final.

The per-item floor remains R5.

## 5. Disclosures carried from the run and the legs

- "Withheld" for A-pre was implemented as a baseline-delivered chunkId absent from the candidate's delivered set; it folds in the fusion-difference loss of § 3, which is why A-pre is undetermined rather than refuted.
- After a pre-fusion removal an item left in neither leg (RRF 0) is dropped as a candidate. This shortens a topic query's spec list from τ = 0.535 (one query: 4 of 5 candidates; 2 of 5 at τ = 0.540; 0 at 0.565) — immaterial to the 31's figures, material to the withheld counts and the topic-24 row, including the τ = 0.540 row featured in § 3.
- A-post rows are marked `exact` because A-post never re-queries the index; 42 of 53 A-pre rows and all 8 B rows are `lower-bound`.
- `session_log` contributes no pool on all 55 rows.
- The `passes` predicate compares means rounded to four decimals against the rounded baseline; conservative against the FAIL here and unexercised, but a candidate in (0.39515, 0.39516) would pass on the letter while having dropped p@8.
- B is A-pre-shaped but excluded from the arm verdict by the pre-registration's wording; unexercised (every B candidate fails).
- The set-identity figure (81 of 110) is the raw-rank reading; the script's compacted-rank variant gives 80 as sets and 63 ordered.
- Commit `0c656720`'s message claimed a re-seal its diff did not contain; `5195a9f8` cured it. The run commit's "299 items at τ = 0.655" carries the under-count of § 3.
- Deltas are rounded from unrounded means and may differ from the rounded difference by 0.0001.

## 6. Follow-ups

- R5: the live-index `distanceRange` arm, pre-registered before it runs. The self-consistent comparator in § 3 suggests it passes, on rows the record marks `lower-bound`; the live arm removes that bound.
- A note on the R1 record: the pool export reproduces production fusion as a set in 81 of 110 pairs (raw ranks), and collapses distinct chunks sharing a heading onto one chunkId (51 clashes).
- A lesson-relevance measurement (distribution and labels) before any lesson-pool gate.
