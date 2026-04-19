---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

core: thread per-invocation `RuleEngineContext` through the rule engine

Removes the module-level `let coreLogger` / `let shieldContextDeprecationWarned` state from `rule-engine.ts` and replaces the hidden DI setter (`setCoreLogger` / `resetShieldContextWarning`) with a required `RuleEngineContext` parameter on `applyRulesToAdditions`, `applyAstRulesToAdditions`, `applyRules`, and `extractJustification`. Concurrent or federated rule evaluations cannot bleed logger wiring or deprecation-warning latching across each other. Closes mmnto-ai/totem#1441.

**Breaking:** `setCoreLogger` and `resetShieldContextWarning` are removed from `@mmnto/totem`. Callers must build a `RuleEngineContext` once per linting invocation and pass it as the first argument to the affected functions. See the README or the `RuleEngineContext` JSDoc for the shape.
