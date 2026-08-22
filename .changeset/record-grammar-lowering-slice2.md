---
'@mmnto/totem': minor
---

Lower parsed Prop 310 rule records into compiled rules, add their compiled homes on `CompiledRuleSchema` (`excludeGlobs`, `requires`, `examples`, `language`, `verificationShadow`, `recoveryHint`, `curation` — all optional), and evaluate the § Design 7 two-array glob scope and § Design 8 `requires` two-pass at lint time (slice 2 of the Prop 310 build).
