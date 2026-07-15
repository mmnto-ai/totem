---
'@mmnto/mcp': minor
'@mmnto/cli': minor
---

feat(doctor): `totem doctor --compliance` recall-rate reader + the ADR-029 A.3.a producer stamp (mmnto-ai/totem#2362).

ADR-029's Compliance Rate (% of coding sessions where `search_knowledge` preceded the first commit) is now a measured sensor rather than a `Goal:` claim. Two halves, one telemetry pair (`.totem/.search-log.jsonl` + git commit timestamps), sensor-only per Tenet 13 — a readout, never a gate.

- **Producer (`@mmnto/mcp`):** `SearchLogEntry` gains three optional A.3.a fields — `agent_source`, `session_id`, `correlation_id` — stamped at log time from the environment (`TOTEM_SELF_AGENT` / `TOTEM_SESSION_ID` / `TOTEM_CORRELATION_ID`) in one producer touch. Absent env → an explicit `null` (Tenet 4, never guessed). The ~420 pre-schema entries stay permanently unattributed (no retro-inference).
- **Reader (`@mmnto/cli`):** new `totem doctor --compliance` section computes the rate from the existing log against git history. Entries partition by `agent_source` (null → an explicit "unattributed" bucket, surfaced with its count) BEFORE the ADR-029 § 2 rolling-2h clustering, so concurrent multi-seat sessions no longer merge; an explicit `session_id` overrides the time heuristic. Readout shows the overall rate + per-seat rates (each with n), a "commit-granularity per ADR-029 § 1" caveat, low-n honesty ("insufficient data (n=x)" below 5), and the doctor `skip` idiom (not a fail, not 0%) when the log file is absent.

Consumer-impact: new `totem doctor --compliance` section (never affects exit codes); three new optional `SearchLogEntry` fields on the MCP search log (additive — existing log readers unaffected, legacy entries render as unattributed). No breaking changes.
