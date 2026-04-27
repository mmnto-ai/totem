---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

fix(core): enable ast-grep verification in `verifyRuleExamples` (mmnto-ai/totem#1699)

AI Studio corpus audit ([mmnto-ai/totem-strategy#150](https://github.com/mmnto-ai/totem-strategy/pull/150), B-Q4.1 / Q5 P2-1) finding. `verifyRuleExamples` short-circuited every non-regex rule via `if (rule.engine !== 'regex') return null;`, so ast-grep rules were never verified against their inline `**Example Hit:**` / `**Example Miss:**` blocks during compilation or via `totem rule test`. The downstream tester (`packages/core/src/rule-tester.ts`) already supports ast-grep through its `isAstGrep` branch — the entry point upstream of it was dropping the rule before the existing path could run.

Real cases were slipping through this gap. Archived rule `e2341ed9229f9a60` shipped with pattern `new $ERROR($$$ARGS)`, matching every error class instantiation; the smoke-gate's bidirectional check (mmnto-ai/totem#1591) would have caught it at compile time if `verifyRuleExamples` had not blocked the engine.

- **Guard narrowed.** Changed `if (rule.engine !== 'regex') return null;` to `if (rule.engine !== 'regex' && rule.engine !== 'ast-grep') return null;`. Tree-sitter (`engine: 'ast'`) stays skipped because `testRule`'s non-`ast-grep` branch routes through `applyRulesToAdditions`, which is the regex pipeline and does not handle S-expression queries.
- **Tests.** Added two regression cases pinning the new behavior: ast-grep PASS on a matching badExample / non-matching goodExample, and ast-grep FAIL on the over-broad `new $ERROR($$$ARGS)` shape (the `e2341ed9229f9a60` exhibit class). The pre-existing test that asserted ast-grep returns null is rewritten to cover the Tree-sitter `'ast'` engine, which still legitimately short-circuits.
- **No CLI surface change required.** `totem rule test <ast-grep-hash>` now returns PASS / FAIL against inline examples instead of warning "Engine 'ast-grep' does not support inline example testing." The compile-pipeline smoke gate (`compile-smoke-gate.ts`) inherits ast-grep coverage through the same entry point.

Closes mmnto-ai/totem#1699.
