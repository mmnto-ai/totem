---
'@mmnto/cli': patch
---

The unused Claude Code lint-gate template and its installer function are deleted (mmnto-ai/totem#3005). Nothing has called them since the gate architecture reset of 2026-03-29, so `totem init` output is unchanged. `totem eject` still removes a legacy `.totem/hooks/shield-gate.cjs` from a project that installed one before then. The enforcement-model doc now says what ships on Claude Code: the write shield and the gate-engine interlocks that `totem gate install` or `totem init --gates=…` adds, hooks in the project's `.claude/settings.json` that keep no state of their own and do not run the compiled rules. Each judges the one tool call in front of it: for a gate interlock, a `deny` verdict blocks the call at the strict tier and is reported at the pilot tier while the call proceeds, and a `warn` verdict never blocks.
