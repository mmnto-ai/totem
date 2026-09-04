---
'@mmnto/mcp': minor
'@mmnto/totem': minor
---

`search_knowledge` classifies a faulted relevance as FAULTED — neither signal nor exemption — on the same predicate the CLI gate and the grounding-bundle builder use (mmnto-ai/totem#2770).

**What was wrong.** The MCP reader selected relevances with a bare `typeof === 'number'`, so a `NaN` or an out-of-range value from the store read as signal: a `NaN` among the hits poisoned `Math.max`, `NaN < floor` was false, the floor never fired, and the tool answered `status="ok"` with the noise it should have withheld — a fault defeating the refusal, the class the mmnto-ai/totem#2761 bot round refuted in the CLI. With no floor (the default since mmnto-ai/totem#2758) a negative or above-1 value was rendered as a measurement in the per-hit field, the envelope and the selection manifest. The mmnto-ai/totem#2738 changeset disclosed this reader as the surface not touched.

**Three classes of hit, one predicate.** Core's `isRelevanceInRange` (finite, in [0, 1]) decides: in range → SIGNAL; no relevance at all (keyword-only) → EXEMPT; a number failing it → FAULTED. `bestRelevance` is the max over signal only; the below-floor arm judges signal only; exempt hits carry a batch as before; a faulted hit never raises `bestRelevance`, is never withheld as a measurement, and cannot carry a batch.

**A new arm.** A retrieval whose EVERY hit is faulted answers `status="no_useful_hits"` — with or without a floor — with the CLI refusal's sentence (`Retrieval returned N hits, but every one carried a relevance that is not a finite number in [0, 1] (tallied out of range by the search layer) — nothing usable to return.`), content withheld and every candidate disclosed by path as `relevance faulted`. This is the one way that status now arises with `floor="none"`; the `min_relevance` description and the docs say so.

**What a reader sees.** The per-hit field prints `**Relevance:** faulted (not a finite number in [0, 1])` instead of a number. The `<retrieval-envelope>` gains a trailing `faulted="N"` attribute, always present so the line keeps one closed shape — a wrapper regex anchored on `hits="N" />` must admit it (no cohort code parses the envelope today; the only readers are prose and this package's own log line, which matches `bestRelevance` by name). Under a floor, the disclosure adds `N hit(s) carried a relevance … and did not count as signal or as exemption.` and a `Faulted candidates` list. The selection manifest records a faulted hit as `excluded` with reason `relevance-faulted (not a finite number in [0, 1])` on the withheld arms and as `selected` with `returned rank=N (relevance faulted)` on the ok arm; its context carries a `faulted` count, which is why `@mmnto/totem` moves too — `faulted` joins the CLOSED `SELECTION_CONTEXT_KEYS` set (a deliberate schema change by that set's own rule).

**Unchanged.** The floor semantics: a whole-run gate on the best in-range relevance, exempt hits unchanged, `min_relevance` overriding both ways. A batch with no faults renders byte-identically apart from `faulted="0"`.
