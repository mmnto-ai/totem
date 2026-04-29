---
'@mmnto/cli': patch
---

`totem review --estimate` gains a pattern-history overlay layer that reads `.totem/recurrence-stats.json` (the `mmnto-ai/totem#1715` substrate) and surfaces historically recurring uncovered patterns whose tokens are present in the diff additions above a 0.4 containment threshold. The overlay runs after the deterministic-rule pass, does not invoke the LLM, and degrades gracefully when the substrate is missing or malformed. Opt out per-invocation with `--no-history`.

Closes mmnto-ai/totem#1731.
