---
'@mmnto/cli': patch
'@mmnto/totem': patch
---

### Knowledge Quality & Security

- All 59 universal baseline lessons now include actionable Fix guidance — agents know HOW to resolve violations, not just WHAT is wrong (#642)
- Path traversal containment check using path.relative prevents reads outside the project directory (#738)
- Traversal skip now logs a warning via onWarn callback for visibility (#739)
