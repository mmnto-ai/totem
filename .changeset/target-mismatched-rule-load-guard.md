---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

fix(lint): target-mismatched AST rules fail loud at rule load instead of aborting a future lint

An `ast-grep` (or `ast`) rule whose declared `fileGlobs` all point at extensions with no registered Tree-sitter language can never execute — and it did not fail quietly. `resolveAstGrepLangs` silently falls back to `Lang.Tsx` when no glob resolves, so the rule looked healthy at load; `rule-engine.ts` then threw `TotemParseError` the first time a diff happened to contain a file the rule's globs claimed, and that throw escaped the per-file loop and aborted the **entire** lint. The observed specimen was a rule scoped to four `.json` paths. Diff-dependent detonation is the worst property of the class: the gate reads green on every run until the one run where it doesn't.

`totem lint` now validates every loaded AST rule at load time, adjacent to the corpus-bearing gate from mmnto-ai/totem#2499 and with the same fail-closed posture. A rule with non-empty `fileGlobs` whose positive globs all name concrete extensions, none of which resolves to a registered language, throws a `TotemError` naming each offending `lessonHash`, its engine, its globs, the unregistered extensions, and all three remedies (sync the pack that provides the language, archive the rule, or fix its globs/engine) alongside a snapshot of the currently-registered extensions. The check runs on every invocation regardless of the diff, and both `'ast-grep'` and `'ast'` rules are covered because `rule-engine.ts` aborts on the union of the two.

The pre-existing `--ast-parse-mode lenient` operator escape (mmnto-ai/totem#1982) is honored: in lenient mode the guard renders the same accounting as a warning and lets the run continue, since the offending rules are inert either way. Without that branch the guard would remove the only way to lint a repo whose rules target a pack language it has not installed yet. The strict default is unchanged and still fails closed.

Two shapes stay permitted: **globless** rules keep the documented `Lang.Tsx` fallback (unscoped pre-1.16 rules, which `rule-engine.ts` never throws for), and **extensionless positive globs** (`src/**`, `**/*.{ts,json}`) are treated as resolvable — they match `.ts` files at run time, so absence of a trailing extension is absence of evidence, not proof of mismatch. Lifecycle status needs no handling: `loadCompiledRules` already drops archived / pending-verification / untested-against-codebase rules before the guard sees them, which is what makes archiving a working remedy. Pack-contributed languages are honored — `bootstrapEngine` runs before the check, so a pack that registers `.rs` has already populated the registry.

`@mmnto/totem` additionally exports `TRAILING_EXT_RE` so the guard extracts target extensions exactly the way `resolveAstGrepLangs` does; a divergent copy would make the guard disagree with the dispatcher it protects.

Class 7 of the Prop 309 hardening program (mmnto-ai/totem-strategy#971).
