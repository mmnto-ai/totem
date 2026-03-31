---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

feat: prior art concierge for `totem spec` (#1015)

Injects shared helper signatures into the spec prompt so agents discover existing utilities (safeExec, readJsonSafe, git helpers, maskSecrets) instead of reimplementing them.
