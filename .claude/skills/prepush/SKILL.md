---
name: prepush
description: Pre-push checks — lint, shield, and format before pushing
---

Before pushing code:

1. Run `pnpm run format:check` — fix any formatting issues with `pnpm run format` if needed
2. Run `pnpm exec totem lint` — fix any violations before proceeding
3. Run `pnpm exec totem shield` — review the output, address critical findings
4. After all checks pass, mark shield as verified: `mkdir -p .totem/cache && git rev-parse HEAD > .totem/cache/.shield-passed`
5. Only after all four steps complete, proceed with `git push`

If any step fails, fix the issue and re-run from step 1. Do NOT push with failing checks.
