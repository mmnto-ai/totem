---
'@mmnto/cli': patch
---

docs(skills): add visiting-Claude/Gemini fallback to /signoff (mmnto-ai/totem#1966)

Closes [mmnto-ai/totem#1966](https://github.com/mmnto-ai/totem/issues/1966).

The post-Proposal-282 `/signoff` skill resolves a journal write path via a hardcoded agent-id map, but the map carries two rows that lack a Claude variant: `totem-status` (`_(no Claude variant)_`) and `totem-playground` (`_(orphan stream — no native agent)_`). A Claude session visiting one of those repos (e.g., `strategy-claude` hopping over to inspect the dashboard) and invoking `/signoff` would hit a dead end — no agent-id, no journal path, no fallback. The same gap exists in the Gemini parity skill for `totem-playground`.

The fix is a "visiting case" paragraph in step 2a of both skill bodies: when the row's vendor column is empty for the visiting agent, write to `<repoRoot>/.totem/orchestration/<your-home-agent-id>/journal/` — i.e., the visiting agent records its session under its own home agent-id within the host repo's orchestration tree. The host doesn't need a native variant to be a valid write target; the journal is for the visitor's state, not the host's.

Surfaces updated symmetrically:

- `mmnto-ai/totem:.claude/skills/signoff/SKILL.md` — canonical Claude skill
- `mmnto-ai/totem:.gemini/skills/signoff.md` — Gemini parity
- `mmnto-ai/totem:packages/cli/src/commands/init-templates.ts:SIGNOFF_SKILL_CONTENT` — `totem init` template (kept byte-identical to the canonical via `installed-skills-match-source.test.ts`)

Strategy-Claude propagates the consumer-side drift fix in a separate pass on consumer repos (`mmnto-ai/totem-strategy#363` style). Option 1 from the ticket — visiting fallback in canonical — chosen over option 2 (remove the Claude skill from `totem-status`) because option 1 is cohort-portable: it addresses both `totem-status` and the orphan-stream `totem-playground` case with the same paragraph, where option 2 would only help one repo.
