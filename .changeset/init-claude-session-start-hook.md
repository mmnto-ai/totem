---
'@mmnto/totem': minor
---

`totem init` now installs a Claude Code `SessionStart` hook (`.claude/hooks/SessionStart.cjs` + a merged entry in committed `.claude/settings.json`), giving Claude sessions the same `totem describe` orientation banner that Gemini-side `.gemini/hooks/SessionStart.js` has produced since pre-Phase-B. New repos joining the family no longer require a manual mirror from a sibling project to get parity. The hook is `.cjs` (load-bearing for `package.json` `type: module` repos), routes the CLI's stderr to stdout so the orientation lands in Claude's prompt, and falls back gracefully if `@mmnto/cli` isn't installed or the describe call fails. Closes the install-side asymmetry from `mmnto-ai/totem#1845` slice 1.

`totem eject` now scrubs both the new SessionStart entry and the Phase B PreWriteShield entry from committed `.claude/settings.json`, plus removes the corresponding `.claude/hooks/*.cjs` scaffold files (marker-checked so user-authored hooks survive). Closes the eject-parity gap left over from Phase B (`mmnto-ai/totem#1852`). User-defined entries under `hooks.PreToolUse` and `hooks.SessionStart` are preserved; empty arrays/objects/files are pruned bottom-up.

Refactor: extracted `mergeClaudeHooksKey` as the single source of truth for the read → safeparse → idempotency probe → append → write merge logic. `scaffoldClaudeHooks`, `scaffoldClaudeWriteShield`, and the new `scaffoldClaudeSessionStart` are thin wrappers. `ClaudeSettingsSchema` now validates both `hooks.PreToolUse` and `hooks.SessionStart` shapes (passthrough preserves user fields).
