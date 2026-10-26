---
name: prepush
description: Pre-push checks — format and lint gates, then the advisory AI review pass
---

Before pushing code:

1. Run `pnpm run format` — fix any formatting issues
2. Run `pnpm exec totem lint` — the deterministic enforcement floor (zero LLM). Fix any violations before proceeding; the pre-push hook enforces this in every tier.
3. Run `pnpm exec totem review` — supplementary AI lanes over the diff (advisory sensors, not a merge gate). Address critical findings; known limits are disclosed in the run output (LLM window truncation on large diffs; non-code files skipped). Note: in strict/agent hook tiers the pre-push hook also runs this command as a push gate — the advisory framing is about what counts as the review of record, not about whether the hook runs it.
4. Before any external review bot is invited (the operator triggers them; you never do), drive the local lane to settled over the branch-vs-base diff with `/review-loop`, running `totem review --branch` (the scope the hook grades; plain `totem review` reads the working tree whenever it is dirty): WARN and CRITICAL are actionable, INFO is cosmetic, `settled` is read from the CLI, never derived, and a disputed finding or the max-rounds advisory stops the loop and is reported, as `/review-loop` says (it also configures `review.lanes` first; with no lanes there is nothing to settle). When the run names a truncation (the `-char review window` line, the file listed as "shown in part" and the files listed as "not shown"), the covariate line describes only the delivered slice, whatever `settled=` says: review the partly shown file and the unseen files over their commit ranges with `totem review --diff <range>` (a range takes no pathspec, so a slice re-includes every file its commits touch and reads deltas, not the end state), stop and disclose when a single commit or file is itself larger than the window, and quote in the round disposition the whole-branch `local-lane:` line PLUS the slice runs and what they left unread, never calling the branch diff reviewed while a tail is unread; a lane that ABSTAINS on a truncated diff is a degraded round, never settled. The slicing this step asks you to do by hand is mmnto-ai/totem#3118, which makes the CLI do it. On mmnto-ai/totem#3114 seven of the nine covariate lines quoted through round 7 read `settled=false`, and four of the seven findings of rounds 5 to 7 sat in files the window had cut.
5. Before a PR's first push, read the changeset's and the body's guarantees against an inventory of what the code still reads from the checkout (the rule manifest, the config, installed packs, anything not read through the diff's revision), and give every disclosed limit its issue when you file it — a limit that points nowhere is a review round waiting to happen (mmnto-ai/totem#3116 was that round).

After all checks pass, proceed with `git push`. The review command stamps `.reviewed-content-hash` automatically on PASS.

If any step fails, fix the issue and re-run from step 1.
