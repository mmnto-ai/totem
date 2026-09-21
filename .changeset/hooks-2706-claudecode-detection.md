---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-agent-workflow': minor
'@mmnto/pack-rust-architecture': minor
---

The managed pre-commit and pre-push hooks now recognise a Claude Code shell (mmnto-ai/totem#2706). Their agent-detection block arms the strict tier on `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`, the two variables Claude Code actually exports into every tool shell, beside the previous `CLAUDE_CODE_AGENT`, `CLAUDE_VERSION` and `CURSOR_TRACE_ID`. Five seat-measurements across four repositories between 2026-08-30 and 2026-09-13 found no live Claude Code session carrying the old two names, so the "AI agents get strict automatically" sentence in the managed CLAUDE.md block described a mechanism that never fired on any Claude Code seat; the sentence now names the variables and the opt-in for other seats, and the reflex block version moves to 16 so `totem init` refreshes it.

**BEHAVIOUR CHANGE for Claude Code seats, at the next hook re-render** (`totem init`, `totem hook install`, or a consumer's `prepare`): the pre-commit hook blocks a commit until the checkout carries an anchored `totem spec` run artifact, and the pre-push hook runs the three strict arms: the legs gate in blocking mode (a legs-owed push with no fresh deposit is refused), `totem doctor --strict` (the repo-state gate), and the shield gate (`totem review --gate`, the local review lanes with the declared disposition-to-exit mapping). The claim-discipline gate is not one of them; it already ran at every tier. A seat that already runs `totem spec` and the review leg by discipline sees no new step; a fresh worktree sees one BLOCKED line with the one-command cure. There is no repo-level opt-out, and there never was one for Cursor seats: the arm is `is_agent = 1 OR tier = strict`, so an installed block that reads `TOTEM_HOOK_TIER="standard"` still arms when the shell carries a marker, and a `hooks.tier: 'standard'` pin in `totem.config.ts` does not suppress it (the config schema has said so all along: "Agents are auto-detected and enforced at strict level regardless of this setting"). The per-command overrides are the ones the hook header names (`git commit --no-verify`, `git push --no-verify`) or running that one command with the variable unset. No exit code, flag or file format changes.
