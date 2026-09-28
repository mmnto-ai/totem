## Lesson — A leg deposit is a tracked file: commit it before the push, because CI's legs gate reads the checkout

**Tags:** manual, legs, ci

A falsification-leg deposit is a TRACKED file under .totem/artifacts/legs/<sha>.json that rides its own commit on the branch. The local pre-push legs gate accepts an untracked deposit sitting in the working tree, but the CI Totem Lint job runs the same gate against the checkout and exits 3 (legs-owed) when the deposit was never committed: three PRs went red at once on 2026-09-24 (mmnto-ai/totem#2959, mmnto-ai/totem#2960, mmnto-ai/totem#2961) until each deposit was committed and pushed. Write the deposit, git add it, commit it, then push; a green local gate is not the CI gate.
