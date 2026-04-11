---
'@mmnto/totem': patch
---

Filter `status: 'archived'` rules out of `loadCompiledRules` (#1336)

`loadCompiledRules` previously returned every rule in `compiled-rules.json` regardless of lifecycle state. The schema had the `status: 'active' | 'archived'` field since the `totem doctor --pr` GC phase shipped, the doc comment on the schema literally said "active rules are enforced, archived rules are skipped", and the `totem doctor --pr` self-healing loop mutated stale rules to `status: 'archived'` with an `archivedReason` — but nothing in the lint execution path actually filtered them out. The self-healing loop was a placebo: archiving a rule via `totem doctor` left it firing in the linter. The only way to truly silence a rule was to delete it from the JSON.

`loadCompiledRules` now applies `parsed.rules.filter((r) => r.status !== 'archived')` before returning. Legacy rules without a `status` field stay enabled (using `!== 'archived'` rather than `=== 'active'` so undefined is treated as active). `loadCompiledRulesFile` remains unfiltered so admin consumers (`totem doctor`, `totem compile`, `totem import`) can still read archived entries for lifecycle management and telemetry persistence — archiving is not deletion; the rule stays in the manifest.

Effect: `totem doctor --pr` archive path now works as documented. Archived rules no longer produce violations during `totem lint`, `totem review`, or `runRuleTests`. No config migration required.
