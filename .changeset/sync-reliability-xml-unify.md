---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

fix: sync reliability and unified XML escaping

- Persistent sync state tracking via .totem/cache/sync-state.json — no more missed changes (#155)
- Deleted files are now purged from LanceDB during incremental sync (#156)
- Unified wrapXml utility in @mmnto/core with consistent backslash escaping (#158)
