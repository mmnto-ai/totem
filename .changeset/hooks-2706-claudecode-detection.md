---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-agent-workflow': minor
'@mmnto/pack-rust-architecture': minor
---

The managed pre-commit and pre-push hooks now recognise a Claude Code shell (mmnto-ai/totem#2706). Their agent-detection block arms the strict tier on `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`, the two variables Claude Code actually exports into every tool shell, beside the previous `CLAUDE_CODE_AGENT`, `CLAUDE_VERSION` and `CURSOR_TRACE_ID`. Measured on three seats across two machines between 2026-08-30 and 2026-09-13, no live Claude Code session ever carried the old two names, so the "AI agents get strict automatically" sentence in the managed CLAUDE.md block described a mechanism that never fired on any Claude Code seat; the sentence now names the variables and the opt-in for other seats, and the reflex block version moves to 16 so `totem init` refreshes it.

**BEHAVIOUR CHANGE for Claude Code seats, at the next hook re-render** (`totem init`, `totem hook install`, or a consumer's `prepare`): the pre-commit hook blocks a commit until the checkout carries an anchored `totem spec` run artifact, and the pre-push hook runs the strict arms (the legs gate blocks a legs-owed push with no fresh deposit; the claim-discipline and shield gates run in strict mode). A seat that already runs `totem spec` and the review leg by discipline sees no new step; a fresh worktree sees one BLOCKED line with the one-command cure. A repo that pins `hooks.tier: 'standard'` in `totem.config.ts` is unaffected, as before: the tier declaration wins over detection only in the direction the hook already honoured, so read the block's own comment before assuming. No exit code, flag or file format changes.
