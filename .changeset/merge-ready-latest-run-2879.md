---
'@mmnto/totem': patch
---

fix(gates): merge-ready predicate 1 judges a check NAME by its latest run — a concurrency group's cancelled duplicate beside the run that superseded it no longer reads as a failing check (mmnto-ai/totem#2879). The `CheckRun` fragment selects `databaseId` (GitHub's check-run id, the only ordinal: the rollup's order is not chronological); `checks.total` counts names the way `gh pr checks` and the merge box do, and a new `checks.superseded` counts the replaced runs, each disclosed on stderr with the run that stood in; a same-named group with an unreadable id is an unreadable check state (unevaluable at both tiers), never "the first one listed". A lone cancelled run still denies.
