---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

ADR-088 Phase 1 Layer 4 substrate: compile --verbose trace + doctor stale-rule advisory.

`totem compile --verbose` emits a structured per-lesson layer-trace block
that shows which pipeline the lesson took, the generated pattern hash,
verify outcome, retry scheduling, and the terminal result plus reasonCode
on skip. Output ships via a single `process.stdout.write` per lesson so
concurrent compiles do not interleave within a block. The trace is
produced unconditionally on `CompileLessonResult.trace` across all three
pipelines (layer 1 manual, layer 2 example-based, layer 3 Layer 3 LLM
with verify-retry); callers that do not pass `--verbose` pay only the
cost of a small per-lesson array.

`RuleMetric` gains an `evaluationCount` field. `runCompiledRules`
increments it exactly once per rule per lint run, regardless of how many
matches fire. Pre-#1483 rule-metrics.json files load with the new field
defaulted to zero via Zod, so the migration is transparent.

`totem doctor` adds a stale-rule advisory that flags active rules whose
cumulative `evaluationCount` has crossed a configurable window while
`contextCounts.code` stayed at zero. Security rules (category=security
OR immutable=true) land with a higher-severity label and the advisory
declines to recommend archival for them; standard rules get both
`totem compile --upgrade <hash>` and archival as recovery paths.
`TotemConfig.doctor.staleRuleWindow` (default 10) gates the check. v1
uses cumulative-lifetime semantics; #1550 tracks the rolling-window
upgrade via `RuleMetric.runHistory` ring buffer, behind the same config
key so no user migration is needed.

Advisory only: no auto-archive, no mutation to the rules file. The
existing `totem doctor --pr` autonomous minAgeDays GC path is untouched.

Closes #1482. Closes #1483.
