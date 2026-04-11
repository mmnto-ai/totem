---
'@mmnto/totem': patch
---

Add parser-based semantic validation to `validateAstGrepPattern` (#1339)

The pre-#1339 validator used a heuristic brace/paren depth tracker that caught obvious multi-root patterns (`;` or `\n` at depth 0) but missed single-line patterns that ast-grep still rejects as "Multiple AST nodes are detected" at runtime. The canonical failure from the 1.14.1 postmerge compile was `.option("--no-$FLAG", $$$REST)` — a floating member call with no receiver. The pattern has balanced parens, no statement separators, one visible "expression", and sails through the heuristic. ast-grep's actual rule compiler rejects it because `.option(...)` isn't a valid AST root node without a receiver. Result: the broken rule landed in `compiled-rules.json`, and every PR rebased on main that touched any `.ts` file crashed `totem lint` until someone manually deleted the rule.

The fix keeps the existing heuristic as a fast-path (good error messages for the common cases) and adds a second layer that invokes ast-grep's actual rule compiler via `parse(Lang.Tsx, '').root().findAll(pattern)`. If ast-grep cannot compile the pattern into a single-rooted rule, the error surfaces at compile time instead of at runtime. The Tsx language is the most permissive parser (superset of TypeScript plus JSX), so any valid JS/TS/JSX/TSX pattern should pass. Empty source keeps the call cheap — ast-grep compiles the pattern into a rule object before iterating any AST, so rule-compile errors surface even against nothing to match.

Also catches the latent `catch($E) { $$$ }` bug: bare catch clauses look valid to the heuristic but ast-grep rejects them because they can only exist as children of a try statement. The pre-existing test that asserted this pattern was valid was aspirational — no production rule ever used it (the compile gate nudged real rules into try-wrapped forms like `try { $$$BODY } catch ($ERR) {}`), so the bug never surfaced in shipped rules, but it would have on the first rule that tried.

Lite-build safety: `validateAstGrepPattern` is only called from compile flows (`buildCompiledRule` / `buildManualRule`), which require an orchestrator and therefore never run in the Lite binary. The esbuild alias swaps `@ast-grep/napi` for the WASM shim in Lite builds, but since this function is dead code there, the shim's `ensureInit()` requirement is never triggered. The parser call is additionally wrapped in try/catch so any surprise error degrades conservatively to `valid: false` rather than crashing.

Audit: all 203 production ast-grep rules in `.totem/compiled-rules.json` parse cleanly through the new check. No rule regressions.
