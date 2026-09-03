# R2 — the labelled fixture, then faithfulness (mmnto-ai/totem-strategy#1193)

## Why a fixture first

No positive control was retained (mmnto-ai/totem#2700's exhibits 1, 2 and 4 have no artifact; exhibit 3 is the 1-byte draft `29bacc3e…`). The 55 retained drafts were therefore hand-adjudicated before any scorer ran.

## Method

1. Mechanical referent pass (`scripts/r2-referents.mjs`): every path, backticked identifier and `--flag` in each draft, resolved at `mainCommitAtRun` (approximate: main at the run's timestamp) and at HEAD `8d5e2691`, with a `proposedContext` flag for referents the surrounding sentence creates. Output `r2-referents.ndjson` + `r2-referents-summary.md`. Totals: 264 paths / 536 identifiers / 31 flags named; missing at run AND not proposed: 64 / 61 / 5.
2. Adjudication (three Opus legs, `index % 3`, each reading every draft in full against the tree at the run commit with its own `git show` / `git grep` reads; rubric in the leg brief): `CONFABULATED` = at least one load-bearing false existence claim the Technical Approach or Implementation Tasks depend on, or a substantially fictional architecture; `PARTIAL` = false claims exist but are peripheral and the plan is anchored on real files and mechanisms; `GROUNDED` = zero false existence claims; `EMPTY`. Per row: the cited referents with the check that was run, a severity 0–3, a confidence. Output `r2-labels-part{0,1,2}.ndjson`, merged in file order as `r2-labels.ndjson` (`r2-labels.summary.json`).
3. Seat spot-check: 3 rows re-verified by the seat with its own git reads (`56fd363b` CONFABULATED — no `packages/cli/templates` tree at `ea80ce11`; `1331db73` CONFABULATED — federated `score` is overwritten with `1/(61+rank)` ≤ 0.0164 so the draft's 0.05 floor rejects every hit, and `SearchKnowledgeInputSchema` does not exist; `43b0939a` GROUNDED — `FILE_EXTENSIONS` is a Set without `.mts`/`.cts` at `f900e807`); 3/3 hold. One open call (`aeb91deb`, a "Prop310 V1 JSON format") was settled by the seat against Proposal 310 itself: V1 records are YAML `.rule.yaml` with `schemaVersion: 1`, so CONFABULATED stands.

## Labels (n = 55)

| | CONFABULATED | PARTIAL | GROUNDED | EMPTY | n |
|---|---|---|---|---|---|
| issue-anchored | 7 (22.6 %) | 20 | 4 | 0 | 31 |
| topic-anchored | 9 (37.5 %) | 12 | 2 | 1 | 24 |
| all | 16 (29.1 %) | 32 | 6 | 1 | 55 |

Severity: 0 ×3 · 1 ×23 · 2 ×23 · 3 ×6. Confidence: high ×50, medium ×5. Cited confabulated referents: 152 (74 load-bearing); grounded existence claims verified: 360.

Rubric boundaries the legs named (recorded so the labels are reproducible): GROUNDED requires zero false existence claims, so a hedged wrong test path makes a draft PARTIAL; a false claim inherited verbatim from the anchor issue counts against the draft only when the leg chose so (one row, `0426a34a`, held at PARTIAL on that ground); bare-slug topic runs were scored on repo-checkable claims only — a draft can be GROUNDED while inventing its subject (`b1cf42a0`), because the fixture carries no issue body for a topic.

## What the mechanical pass cannot see

The referent-existence ratio (missing-not-proposed ÷ named) does not separate the classes: CONFABULATED mean 0.159 (median 0.188), PARTIAL 0.135 (0.100), GROUNDED 0.197 (0.250). The extremes invert — the most severe confabulation in one leg's third (`518e6de3`: a traversal bug invented in `isContained` by inverting the function's own comment) has a ratio of 0.000, and the cleanest draft in that third (`4fb89ea7`) has the highest ratio in the whole set (0.429). The dominant confabulation class is BEHAVIORAL — a real file read with the wrong format, a shipped command planned from scratch (`packages/cli/src/commands/review.ts`, invented by two drafts; `totem review` is `runReview` → `shieldCommand`), a real config given an invented schema, work prescribed that is already done — and the extractor has no slot for it. Two smaller instrument limits: directory referents (no extension) are never extracted; `git grep -F` substring hits mark `ParityContractSchema` found because `RawParityContractSchema` exists.

## Faithfulness

Timer semantics: the gemini run's per-row `seconds` (and its summary `meanSecondsPerScored: 809.6`) were recorded OUTSIDE the concurrency gate at concurrency 2, so they include queue wait — the honest per-draft figure for that arm is wall ÷ scored = 1508.3 / 54 = 27.9 s of throughput (≈ 56 s of judge time per draft at concurrency 2). The local run's timer was inside the gate (sum of seconds = wall, 3723.5 s; 69 s per draft). The script now records the timer inside the gate for every run.

See `r2-faithfulness-*.summary.json` and the deposit's § 3.2 for the two judge arms (local `qwen3-coder:30b` via Ollama; `gemini-3.5-flash` via Google's OpenAI-compatible endpoint), both through RAGAS 0.4.3 `Faithfulness` over the three non-empty delivered-context sections, and their separation against these labels.
