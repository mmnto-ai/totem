---
'@mmnto/mcp': patch
'@mmnto/cli': patch
---

fix: harden host integration — XML safety, hook format, config validation, script extraction

- XML-delimit MCP tool responses to mitigate indirect prompt injection (#149)
- Fix Claude hook format: use {type, command} objects instead of bare strings (#153)
- Replace manual type guards with Zod schema validation for settings.local.json (#148)
- Extract inline shell hooks into dedicated Node.js scripts (.totem/hooks/) (#147)
