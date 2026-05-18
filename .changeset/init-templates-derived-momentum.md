---
'@mmnto/cli': patch
---

docs(cli): replace retired active_work.md hint in init-templates Start-of-Session ritual

Closes [mmnto-ai/totem#1948](https://github.com/mmnto-ai/totem/issues/1948). Tier-3 follow-up from [mmnto-ai/totem#1945](https://github.com/mmnto-ai/totem/pull/1945) (which removed the "Read `docs/active_work.md` for momentum" line as part of the broader retirement of `docs/active_work.md` as a project-wide convention).

The scaffolded **Start of Session** ritual at `AI_PROMPT_BLOCK` now points new projects at the MCP `describe_project` tool for derived momentum (active milestone, open gate tickets, recent merged PRs) — same data the retired declarative doc used to carry, sourced from git + filesystem state instead of a hand-maintained file. Aligns with Proposal 264 / Proposal 282 doctrine: state is observed, not declared.

Direction-2 framing from the issue, anchored to a shipped surface (MCP `describe_project` already emits `milestoneName` / `gateTickets` / `recentPrs` via `packages/mcp/src/state-extractors.ts`) rather than the unshipped `totem status --json` v0.2 fields. Cloud bots and local CLI agents both have MCP access; portable.

`REFLEX_VERSION` bumped from 5 to 6 so existing projects' next `totem init` pass detects the stale block and offers an upgrade.
