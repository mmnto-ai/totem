---
name: postmerge
description: Post-merge workflow — extract lessons and wrap
---

After merging PRs, run the post-merge workflow:

1. Run `pnpm exec totem wrap $ARGUMENTS --yes` (pass PR numbers as arguments)
2. Revert compiled rules to curated set: `git checkout HEAD -- .totem/compiled-rules.json`
3. Format wrap output: `pnpm run format`
4. Stage lessons, docs, and exports: `git add .totem/lessons/ README.md docs/ .github/copilot-instructions.md .junie/skills/totem-rules/rules.md`
5. Commit: `git commit -m "chore: totem wrap for PRs $ARGUMENTS"`
6. Report: how many lessons extracted, any doc failures, rule compilation stats (note: new compiled rules were reverted)
