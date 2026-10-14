---
'@mmnto/cli': patch
---

`totem lint`: the advisory note under the Warnings heading no longer reads as if the rule corpus were frozen ("sensed-not-enforced under the rule-compilation freeze"). It now gives the two causes by name: the LEGACY frozen-lesson (regex) rules are sensed-not-enforced because the linter demotes the regex class to advisory (mmnto-ai/totem#2181), and the legacy compile that produced them stays parked under the `rule-compilation` freeze entry — the entry the gate (5) lift ruling of 2026-10-10 kept and re-worded (mmnto-ai/totem-strategy#1486, Q7 (a)); the serving file itself is regenerated from rule records by `totem rule serve`. The comment on the engine-type split in `run-compiled-rules.ts` is re-worded the same way. No behaviour changes.
