# R4 — the owner's reading of the run record (v2, totem-claude, 2026-09-04)

The record is `r4-summary.md` / `r4-floor-arm.json`, generated unedited by `scripts/r4-floor-arm.mjs` from the pre-registration in commit 1. This document is the seat's reading of it; it changes no number and amends no verdict rule after the data.

**v2 supersedes v1 (commit `0c656720`).** v1 claimed the A-post shape "ships"; the falsification leg refuted that at source, and two of v1's numbers were the wrong quantity. v2 states what was refuted and what stands. The generated record is unchanged.

## 1. Verdict by the letter

**R4 FAILS.** The pre-registration made A-pre the deciding shape ("the arm PASSES iff at least one A-pre candidate passes"), and no A-pre candidate holds mean p@8 on the 31 at or above 0.3952 while withholding at least one item over the 55. Forty-four candidates pass, every one of them A-post.

## 2. What the product implements — corrected

Both shipped floors are whole-run gates on the BEST vector-leg relevance of one retrieval. The MCP `search_knowledge` tool answers `status="no_useful_hits"` and returns only floor-exempt hits when `bestRelevance < floor` (`packages/mcp/src/tools/search-knowledge.ts:860`); `totem spec` refuses an unanchored free-text run when `bestRelevance < floor && floorExempt === 0` (`packages/cli/src/commands/spec.ts:716`), and that gate evaluates only on free-text runs — never on the 31 issue-anchored queries the falsifier scores. No shipped path withholds a single sub-floor hit while keeping its siblings.

The pre-registration's provenance sentence for A-post ("the shape the MCP `min_relevance` override implements today") is therefore false, and the generated summary's A-post heading repeats it. A-post is a MODEL of per-item post-fusion withholding that ships nowhere; the frozen text is left as written and corrected here.

## 3. What the record establishes, restated

- **The shipped gate.** On this fixture the lowest best-relevance over delivered specs and code is 0.559 (0.5687 among the 30 refusal-eligible runs, those with no floor-exempt hit). So no configured value below 0.559 fires on any of the 55 queries: the 0.25 default never fired, 0.5287 would not either, and the first refusal appears above 0.5687 — a whole topic run refused. The default is not a number.
- **A-post, the per-item model.** τ_cal2 = 0.5287 (the lowest relevance of any label-2 delivered item, minus 0.0005) withholds 11 of 440 delivered items — 10 label-0, 1 label-1, 0 label-2 — none on the 31; all eleven sit on topic queries, so the 31's figures are unchanged while the topic-24's move (p@8 0.375 → 0.4154, the shrinking-denominator artifact § 3's last bullet names). The lowest DELIVERED relevance is 0.5100 (v1's 0.5022 was the pool minimum); the first withholding is at τ = 0.510. Above τ ≈ 0.56 p@8 rises while label-2 items are withheld: the delivered-denominator definition rewards a shrinking set. These are properties of the model, not of any mechanism in the product.
- **A-pre, the pre-fusion model.** Undetermined against the production baseline: the recorded pool re-fuses (RRF, k = 60) to the production delivered SET in 81 of 110 (query, partition) pairs (65 as ordered lists; 29 pairs differ in a way precision can see), and the no-floor point sits at 0.3911 before any floor acts. Against its OWN no-floor point — a post-hoc comparator, not the pre-registered one — the arm would pass from τ = 0.510, and τ = 0.540 withholds 13 items, none label-2, p@8 unchanged, no refusal. That is evidence the live `distanceRange` arm (R5) is worth running, not a verdict.
- **Duplicates.** Four baseline spec lists carry a duplicated chunkId (an R1 export artifact; relevances 0.5899–0.6512). The withheld count is not inflated at τ_cal2 and is inflated by 1–4 from τ ≈ 0.59 upward; the run commit's "299 items at τ = 0.655" is inflated by 2.

## 4. Consequence for the ruling — corrected

The synthesis (§ 8.2.3, § 9.8) binds the owed calibrated-floor arm to `distanceRange`; nothing in this record discharges it. What the record proves is narrower: the shipped gate's default is unreachable on this profile, and so is any value below a repo's own measured best-relevance floor. So the second branch applies to the DEFAULT only:

1. `searchRelevanceFloor` loses its default. Unset means no floor: no `no_useful_hits` by floor, no spec refusal by floor; the per-call `min_relevance` override keeps its meaning.
2. The docs say what the gate compares — a retrieval's best relevance, whole-run, never per item — the measured range on this profile, and how a repo picks a value (record its runs, note the best-relevance of the weakest run it wants kept, set the floor below that).
3. This repo sets NO value. 0.5287 fires on nothing; a value above 0.57 would only refuse weak topic runs.
4. The lesson pool is NOT coupled to the floor. Lesson relevances on this index sit around 0.34; any value that makes the refusal gate reachable would zero the pool. A lesson gate needs its own measurement against lesson relevances.
5. Lessons never ground a run — final.

The per-item floor remains R5.

## 5. Disclosures carried from the run and the leg

- "Withheld" for A-pre was implemented as a baseline-delivered chunkId absent from the candidate's delivered set; it folds in the fusion-difference loss of § 3, which is why A-pre is undetermined rather than refuted.
- After a pre-fusion removal an item left in neither leg (RRF 0) is dropped as a candidate; immaterial below τ ≈ 0.56.
- A-post rows are marked `exact` because A-post never re-queries the index.
- `session_log` contributes no pool on all 55 rows.
- The `passes` predicate compares means rounded to four decimals against the rounded baseline; conservative against the FAIL here and unexercised, but a candidate in (0.39515, 0.39516) would pass on the letter while having dropped p@8.
- B is A-pre-shaped but excluded from the arm verdict by the pre-registration's wording; unexercised (every B candidate fails).
- Commit `0c656720`'s message claimed a re-seal its diff did not contain; `5195a9f8` cured it.
- Deltas are rounded from unrounded means and may differ from the rounded difference by 0.0001.

## 6. Follow-ups

- R5: the live-index `distanceRange` arm, pre-registered before it runs; the self-consistent comparator in § 3 suggests it passes.
- A note on the R1 record: the pool export reproduces production fusion as a set in 81 of 110 pairs.
- A lesson-relevance measurement (distribution and labels) before any lesson-pool gate.
