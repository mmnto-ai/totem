---
'@mmnto/totem': patch
---

Consolidate rule-engine and spine path matching into one bounded glob compiler while preserving both compatibility profiles. Rule evaluation keeps its historical muted wildcard behavior, the anchored spine classifier keeps brace, question-mark, and normalized-separator support, and the bounded evaluator and git diff filter now route through the shared matcher.
