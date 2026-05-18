---
'@mmnto/cli': patch
---

docs(cli): replace retired active_work.md hint in init-templates Start-of-Session ritual

Closes [mmnto-ai/totem#1948](https://github.com/mmnto-ai/totem/issues/1948). Tier-3 follow-up from [mmnto-ai/totem#1945](https://github.com/mmnto-ai/totem/pull/1945) (which removed the "Read `docs/active_work.md` for momentum" line as part of the broader retirement of `docs/active_work.md` as a project-wide convention).

The scaffolded **Start of Session** ritual at `AI_PROMPT_BLOCK` now points new projects at the MCP `describe_project` tool for richer derived project state — recent merged PRs, current branch + uncommitted files, latest strategy journal pointer, package versions, rule/lesson counts — sourced from git + filesystem state instead of a hand-maintained file. Aligns with Proposal 264 / Proposal 282 doctrine: state is observed, not declared.

Direction-2 framing from the issue, anchored to a shipped surface (these fields are all derived by `packages/mcp/src/state-extractors.ts` today) rather than the unshipped `totem status --json` v0.2 fields. Deliberately excludes `milestoneState` / gate-tickets from the hint — `extractMilestoneState` still parses the retired `docs/active_work.md` and returns null in steady state; broader cleanup tracked at [mmnto-ai/totem#1947](https://github.com/mmnto-ai/totem/issues/1947). Cloud bots and local CLI agents both have MCP access; portable.

`REFLEX_VERSION` bumped from 5 to 6 so existing projects' next `totem init` pass detects the stale block and offers an upgrade.
