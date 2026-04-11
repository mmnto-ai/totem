---
'@mmnto/cli': patch
---

Queue drain: Shield branding consistency (#1313)

Three small queue-drain items bundled into one PR (#1298, #1299, #1302):

- **#1298** — `totem shield` output and `totem --help` entries now consistently use "Shield" branding instead of the legacy "AI Shield" and "shield" mix that had crept in over several releases.
- **#1299** — `/preflight` skill doc-scope expanded to cover the cases where preflight was routinely producing "draft from memory" outputs instead of searching the knowledge base first.
- **#1302** — Dual-hash convention documented in `.gemini/styleguide.md` so cross-agent review produces consistent pattern/content hash formatting.
