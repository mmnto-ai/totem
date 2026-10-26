---
name: prepush
description: Pre-push checks — format and lint gates, then the advisory AI review pass
---

Before pushing code:

1. Run `pnpm run format` — fix any formatting issues
2. Run `pnpm exec totem lint` — the deterministic enforcement floor (zero LLM). Fix any violations before proceeding; the pre-push hook enforces this in every tier.
3. Run `pnpm exec totem review` — supplementary AI lanes over the diff (advisory sensors, not a merge gate). Address critical findings; known limits are disclosed in the run output (LLM window truncation on large diffs; non-code files skipped). Note: in strict/agent hook tiers the pre-push hook also runs this command as a push gate — the advisory framing is about what counts as the review of record, not about whether the hook runs it.
4. Before any external review bot is invited (the operator triggers them; you never do), drive the local lane to settled over the WHOLE diff with `/review-loop`: WARN and CRITICAL are actionable, INFO is cosmetic, and `settled` is read from the CLI, never derived. When the run names a truncation ("exceeds the review window", files "not shown"), re-run `totem review --diff <range>` over the commits that touch the unseen files until no file is listed; a lane that ABSTAINS on a truncated diff is a degraded round, never settled. The covariate line you quote in a round disposition reads `settled=true`. On mmnto-ai/totem#3114 five of the first six heads went to the bots unsettled, and every finding of rounds 5 to 7 sat in a file the window had cut; the slicing this step asks you to do by hand is mmnto-ai/totem#3118.
5. Before a PR's first push, read the changeset's and the body's guarantees against an inventory of what the code still reads from the checkout (the rule manifest, the config, installed packs, anything not read through the diff's revision), and give every disclosed limit its issue when you file it — a limit that points nowhere is a review round waiting to happen (mmnto-ai/totem#3116 was that round).

After all checks pass, proceed with `git push`. The review command stamps `.reviewed-content-hash` automatically on PASS.

If any step fails, fix the issue and re-run from step 1.
