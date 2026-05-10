---
'@mmnto/cli': patch
---

`totem lesson compile --export` and `totem lesson archive` now surface
`status: archived` rules in the agent-facing digest with an
`_(archived: <reason>)_` annotation suffix instead of silently dropping
them. The export digest is the LLM's knowledge surface; Stage-4 archival
concerns pattern-matching false positives, not lesson-prose validity, so
the prose stays useful as agent context even when the compiled regex is
silenced at lint time.

`status: untested-against-codebase` rules continue to be suppressed in the
export per the CR `mmnto-ai/totem#1757` R2 rationale (Stage 4 declared
their behavior unknown, agent context shouldn't rely on them either). The
`loadCompiledRules` lint-time filter is unchanged.

Closes `mmnto-ai/totem#1873`. Empirical evidence base: lc-Claude's
`mmnto-ai/liquid-city#238` postmerge run reproduced n=2 archival drops
across three consecutive `compile --export` invocations (199 → 198 → 198).
Both symptoms (ordering-dependent first-run inclusion and deterministic
re-export drop) collapse with this change.

The hash-drift bug that surfaced Symptom A's ordering dependence remains
as a separate latent concern in the `untested-against-codebase` filter
path. Filed as a follow-up Tier-3 for narrow investigation.
