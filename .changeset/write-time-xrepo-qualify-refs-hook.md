---
'@mmnto/totem': minor
---

`totem init` now installs a write-time `xrepo-qualify-refs` enforcement hook for both
Claude Code (`PreToolUse` matcher on `Write|Edit`) and Gemini CLI (`BeforeTool` on
`write_file`/`edit_file`), scoped to substrate-participating paths (`.handoff/**`,
`.journal/**`, `*.md`).

The hook intercepts bare cross-repo references (e.g., `#247`) before disk write,
returning Claude Code exit code 2 (block) on violation in scoped paths. Eliminates
the friction loop where bare refs only fail at commit-time via `totem lint`.

The hook respects the existing `<!-- totem-context: <reason> -->` suppression
directive (line + preceding-line window), mirroring the lint rule's
`isSuppressed` semantics for verbatim-quotation cases.

Per OQ 2 of `mmnto-ai/totem#1846` design: the new entry installs into committed
`.claude/settings.json` (team-level guarantee, sealed at `mmnto-ai/totem-strategy#145`),
distinct from `.claude/settings.local.json` which holds the per-developer
shield-gate. The asymmetry reflects the architectural distinction between
seal-anchored substrate enforcement and per-developer command interception.

New exports: `BARE_REF_REGEX_SOURCE`, `CLAUDE_PREWRITESHIELD`,
`CLAUDE_PREWRITESHIELD_ENTRY` (from `init-templates`); `scaffoldClaudeWriteShield`
(from `init`). `scaffoldClaudeHooks` refactored internally to share a
`mergeClaudePreToolUseEntry` helper with the new function.

Closes mmnto-ai/totem#1846.
