## Lesson — A restored section is proved by a blob diff, not a re-read

**Tags:** ruled-scope, docs, git-diff, bot-review, decline, falsification-leg, s6

**Applies-to:** presentation

A restored section is verified byte-identical to the merged source except the licensed lines, with a diff against the merged commit's blob, not by re-reading the prose. In S6 step 8 (mmnto-ai/totem#3066) the ruling's Q5 (b) named one README sentence; the first cut re-worded the whole "Where the Loop Stands" section and the how-totem-gets-built bullet, and stated an admission policy for never-migrated records that the S6 note's D6 leaves unruled. Read 1 F4 and a side agent's note caught it; the fold restored the section, and read 2 proved the restoration with git show <merged-sha>:README.md against the worktree, finding only line 90 changed, and the same for the how-built page. CodeRabbit's outside-diff finding on the README's push example (a warnings-only run ending in FAIL) was true at source but on merged text outside the ruled sentence, so it was declined under the scope and filed as mmnto-ai/totem#3074 rather than folded. Rule: when a ruling licenses specific lines, the proof of discipline is a blob diff showing exactly those lines differ; a true finding on unlicensed merged text is filed, never folded into the ruled pull request.

**Source:** mcp (added at 2026-10-14T17:11:12.277Z)
