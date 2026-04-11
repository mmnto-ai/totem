---
'@mmnto/totem': patch
---

Reject nonsense Pipeline 5 observation rules (#1324)

Pipeline 5 (auto-capture from Shield findings) was faithfully converting every source line Shield flagged into an observation rule, including lines that were pure syntactic noise (`}`, `*/`, bare braces) or comment-only. The result was a steady drip of garbage rules that users had to clean up via `git checkout -- .totem/compiled-rules.json` after every `totem review`.

`generateObservationRule()` now rejects source lines with fewer than 3 alphanumeric characters and lines that are entirely comments (JSDoc, block-comment continuation, line comments, bare hash). The check is deliberately minimal — the goal is to drop obvious noise, not to second-guess Shield's judgment on real code.

Closes #1279. Three consecutive reproductions (`*/`, `}`, and PR #1292's own cascade-fix commits) blocked on this gate in testing.
