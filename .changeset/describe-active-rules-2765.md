---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

`describeProject` counts the ACTIVE compiled-rule set — the set `totem lint` enforces and `totem status` reports — instead of the raw file total, and reports the inert split beside it (mmnto-ai/totem#2765; the describe half of the mmnto-ai/totem#2388 parity).

**What was wrong.** `totem describe` (and so the SessionStart banner every session opens on) and the MCP `describe_project` tool's `legacy` block printed `parsed.rules.length` — every entry in `compiled-rules.json`, archived and untested ones included — while `totem status` and `totem lint` count through the loader that applies the mmnto-ai/totem#1345 status filter. On this repository that read `Rules: 485 compiled` at session start against a lint that enforces 385: the 100-rule gap is exactly the archived-plus-untested set lint deliberately does not run, and no surface reconciled the two.

**What changed.** The status filter is now a named predicate, `isActiveCompiledRule` (exported from `@mmnto/totem`), and lint's loader filters through it. `describeProject` reads the file through the same schema-validating loader lint and status use and counts through that predicate, so the three surfaces agree by construction. `ProjectDescription.rules` is the active count; four additive fields carry the rest — `rulesCompiled` (the raw total), `rulesArchived`, `rulesUntested`, `rulesPendingVerification` — with `rules + the three inert counts === rulesCompiled`. The banner line reads `Rules: 385 active of 485 compiled (93 archived, 7 untested-against-codebase)` where the split is non-trivial and `Rules: 12 active` where nothing is inert; never a bare "N compiled" again.

**One consequence to know.** A `compiled-rules.json` that is valid JSON but fails the compiled-rules schema now reports zeros from describe (it previously counted any `rules` array), which is what status already reports for that file and what lint refuses outright. A missing file still reports zeros and the sensor still never throws.

**Unchanged.** What "active" means (mmnto-ai/totem#1345), status's manifest `rule_count` fallback for an absent file, and status's own wording.
