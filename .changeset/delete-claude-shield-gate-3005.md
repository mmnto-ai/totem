---
'@mmnto/cli': patch
---

The unused Claude Code lint-gate template and its installer function are deleted (mmnto-ai/totem#3005). Nothing has called them since the gate architecture reset of 2026-03-29, so `totem init` output is unchanged. `totem eject` still removes a legacy `.totem/hooks/shield-gate.cjs` from a project that installed one before then. The enforcement-model doc now says what ships on Claude Code: the write shield and the gate-engine interlocks that `totem gate install` adds, which are stateless block-on-match hooks in the project's `.claude/settings.json` and do not run the compiled rules.
