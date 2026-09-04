---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

`searchRelevanceFloor` has no default: the value is repo-local, unset means no floor, and the constant that named a default no index ever reached is removed (mmnto-ai/totem#2727).

**What the floor actually is.** A refusal threshold compared against the **best** vector-leg relevance of **one retrieval** — a whole-run gate, not a per-item filter. Nothing in Totem withholds an individual sub-floor hit while returning its siblings. `search_knowledge` answers `status="no_useful_hits"` and discloses the below-floor candidates when a response's best relevance falls under the floor; `totem spec` refuses an unanchored free-text run on the same comparison, and one floor-exempt (keyword-only) hit saves the run. Saying so plainly is part of this change: the config comment it replaces read as a per-hit filter, and the calibration people would have derived from that reading is the wrong calibration.

**The measurement.** R4, over 55 recorded `totem spec` queries at pin `14daff4d` on the gemini-embedding-2-preview 768-d profile (the record is `.totem/fixtures/floor-arm-2026-09-03/`). Relevance is `1 / (1 + squared L2)` on unit-norm vectors, so it ranges over `[0.2, 1]` and real retrievals sit high in it: the **lowest best-relevance of any run was 0.559** — 0.5687 over the runs the spec refusal was even eligible to judge. The shipped default of 0.25 therefore could not fire on a single one of them. It was a mechanism claim with no mechanism, and any value below a corpus's own measured floor is equally inert.

**The ruling.** The default is removed rather than raised. A reachable floor is a property of a corpus, its embedder and its labels — repo-local by construction — so it is not ours to guess. `searchRelevanceFloor` becomes optional with no default; unset means no floor.

**What changed.**

- `searchRelevanceFloor: z.number().min(0).max(1).optional()` — no `.default()`. Bounds unchanged.
- With no floor configured and no per-call `min_relevance`, the below-floor arms cannot fire: `search_knowledge` never answers `no_useful_hits`, and `totem spec`'s below-floor refusal is unreachable. `totem spec`'s **zero-hit** refusal is a separate arm and still fires.
- The retrieval envelope's `floor` attribute reads `floor="none"` when no floor applies (it stays a closed token, so the wrapper-agent single-regex contract holds). The selection manifest records `floor: null` for the same case.
- `totem spec`'s refusal grew a second floor line: `floor none — searchRelevanceFloor unset in totem.config.ts (no default; calibrate per repo — see config-reference)` when unset, and `floor 0.570 — searchRelevanceFloor in totem.config.ts` when set (the old "(schema default 0.25 when unset)" suffix is gone — it named a default that no longer exists).
- A run artifact records `grounding.floor` only when a floor was configured; the key is absent otherwise, rather than carrying a number no floor judged.
- The refusal's lessons clause is now `… but lessons do not ground a run (ruled mmnto-ai/totem#2727).` — that question was open when the clause was written and is now closed. **Lessons never ground a run: final.**
- `min_relevance` keeps its meaning and still overrides, in both directions.

**REMOVED — `DEFAULT_SEARCH_RELEVANCE_FLOOR` is gone from `@mmnto/totem`.** No shim, no compat constant, no deprecated re-export. It existed to keep the schema default and the MCP guard on one number; with no default there is no number for it to name. Measured before removing it: no repo in the cohort imports it. `totem-strategy`, `totem-status`, `liquid-city`, `totem-substrate` and `totem-playground` were searched over tracked files; the only tracked mention anywhere outside this monorepo is prose in one `totem-strategy` research document, and the only code consumers were the two sites inside this repo (the schema default and the MCP guard). Semver is called **minor**, not major, on that basis: a public export was deleted, but it named a default that never fired and nothing outside this repo reads it. The operator may rule major at merge; this is the build's judgment, stated so it can be overruled rather than discovered.

**MIGRATION.** A repo that relied on the schema default sees **no change in delivered results** — that default withheld nothing on any measured index, so the results were already unfloored in fact. Two things look different: `search_knowledge`'s envelope prints `floor="none"` instead of `floor="0.250"`, and a `totem spec` refusal names the floor as `none` instead of `0.250`. A repo that set `searchRelevanceFloor` explicitly is unaffected. Anything importing `DEFAULT_SEARCH_RELEVANCE_FLOOR` gets a TypeScript error at the import — read `config.searchRelevanceFloor` and handle `undefined`.

To make the below-floor arms reachable, calibrate and set a value: record real `totem spec` runs, mark the ones whose retrieval you would want kept, note each kept run's best relevance, and set `searchRelevanceFloor` below the weakest of those. The recipe and the worked measurement are in `docs/wiki/config-reference.md` ("The Relevance Floor"). Recalibrate when the embedder or the corpus changes materially — a floor calibrated on one embedding profile says nothing about another.

**Not in this slice.** The relevance formula (`lance-search.ts`) and whether it must be metric-aware (mmnto-ai/totem#2738); a pre-fusion per-item floor (`distanceRange` — R4's A-pre arm was undetermined, and R5 is pre-registered for it); the dedup similarity threshold (mmnto-ai/totem#2751); any change to which partitions ground a run; any lesson-pool floor, which needs its own measurement against lesson relevances before it can be designed.
