---
'@mmnto/cli': patch
---

Reflex template drift fix: the distributed "Before Implementation" step no longer instructs agents to run `totem spec` "to generate an architectural plan". Standing spec-usage doctrine is that spec output is one retrieval input, never the contract — the softened line says exactly that (optional retrieval; derive the design from primary sources). `REFLEX_VERSION` bumps 8 → 9 so existing consumers' next `totem init` detects the stale block and offers the upgrade. Template-constant fix only — no per-repo hand-edits; the full grounded spec/review redesign remains mmnto-ai/totem#2106.
