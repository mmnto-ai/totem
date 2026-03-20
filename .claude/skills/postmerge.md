---
name: postmerge
description: Post-merge workflow — extract lessons and wrap
---

After merging PRs, run the post-merge workflow:

1. Run `pnpm exec totem wrap $ARGUMENTS --yes` (pass PR numbers as arguments)
2. If wrap generates new compiled rules, revert `.totem/compiled-rules.json` to the curated 147-rule set
3. Commit the wrap output (lessons, docs, exports) but NOT the unvalidated compiled rules
4. Report: how many lessons extracted, any doc failures, rule compilation stats
