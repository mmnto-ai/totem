---
'@mmnto/cli': patch
---

Fix MCP config scaffolding on Windows by wrapping `npx` with `cmd /c` (bare `npx` fails as a spawned command on win32)
