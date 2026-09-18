---
'@mmnto/totem': patch
---

Seat the four Kimi agents in `COHORT_AGENT_MAP` — `totem-kimi`, `strategy-kimi`, `lc-kimi` and `status-kimi` — so a dispatch addressed `to: <repo>-kimi` is visible to `totem mail` on a checkout that has no seat dir for it and no `TOTEM_SELF_AGENT` declared. The orchestration tree is gitignored, so on a fresh clone the map IS the roster the poll can see; until now a Kimi seat resolved only where its dir already existed, which meant a `to: lc-kimi` dispatch read as a clean inbox on any other checkout while the `signoff` skill's step-2a table named the seat. The map and that table are now held to each other as an equality by `signoff-table-sync.test.ts`. Also widens the map's union for the four cohort repositories, so an identity-ambiguous poll's broadcast denominator and per-seat floor count the Kimi seat (mmnto-ai/totem#2875).
