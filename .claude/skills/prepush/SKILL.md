---
name: prepush
description: Pre-push checks — format and lint gates, then the advisory AI review pass
---

Before pushing code:

1. Run `pnpm run format` — fix any formatting issues
2. Run `pnpm exec totem lint` — the deterministic enforcement floor (zero LLM). Fix any violations before proceeding; the pre-push hook enforces this in every tier.
3. Run `pnpm exec totem review` — supplementary AI lanes over the diff (advisory sensors, not a merge gate). Address critical findings; known limits are disclosed in the run output (LLM window truncation on large diffs; non-code files skipped). Note: in strict/agent hook tiers the pre-push hook also runs this command as a push gate — the advisory framing is about what counts as the review of record, not about whether the hook runs it.

After all checks pass, proceed with `git push`. The review command stamps `.reviewed-content-hash` automatically on PASS.

If any step fails, fix the issue and re-run from step 1.
