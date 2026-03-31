---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

feat: intelligent scope inference for `totem extract` (#1014)

Analyzes PR changed files and pre-injects a scope suggestion into the extraction prompt so the LLM produces better file glob scopes on extracted lessons.
