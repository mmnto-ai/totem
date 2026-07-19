---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

fix(review): a review fan with zero completed verdict lanes hard-errors instead of exiting 0 (#2452 slice A)

A `totem review` fan that finished with zero _completed_ verdict lanes could exit 0 when `--fail-on` was omitted: the all-lanes-failed gate keyed on `completed || abstained`, so an abstain-bearing fan (a lane that invoked but whose output was unextractable — sensor-down) skipped the hard-error and read like a pass. The verdict artifact was already honest (`settled=false`, `completedLaneCount=0`); only the process exit was wrong.

The gate now keys on zero completed lanes (`hasNoCompletedLane`, exported from core), fired after the honest verdict is written and before the override/cache-stamp block — so `--override` can never mint a push authorization from a provider-unsettled round (Tenets 12/13). The hard-error message enumerates `completed=0/abstained=N/failed=M` instead of the old "failed to invoke" wording (dishonest for an abstained lane that did invoke). The fan report also splits diff-budget from total-prompt-budget so the two are never double-counted.

Slice A of #2452 (the fan boundary); the CLI-fallback evidence + `invoke-error` taxonomy is slice B.
