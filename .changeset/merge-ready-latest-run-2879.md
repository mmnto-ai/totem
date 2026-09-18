---
'@mmnto/totem': minor
---

fix(gates): merge-ready predicate 1 judges a check NAME by its latest run — any earlier run of the same name, cancelled by a concurrency group or failed, is superseded by the run that came after it and no longer reads as a failing check (mmnto-ai/totem#2879). The `CheckRun` fragment selects `databaseId` (GitHub's check-run id, the only ordinal: the rollup's listed order is not chronological, and a rerun mints a new, greater id); `checks.total` now counts names the way `gh pr checks` does, and the new `checks.superseded` counts the replaced runs, each disclosed on its own stderr line with the run that stood in; a same-named group with an unreadable id is an unreadable check state (unevaluable at both tiers), never "the first one listed"; a lone cancelled run still denies. Minor, not patch: `MergeReadyProvenanceDetail.checks` gains a required field and `total` changes meaning.
