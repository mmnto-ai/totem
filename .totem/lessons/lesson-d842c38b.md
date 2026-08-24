## Lesson — {pattern:'log.error($$$ARGS)'}

**Tags:** ast-grep, constraints, metavariable, engine-semantics, trap, r14

In `@ast-grep/napi` (measured at 0.42.0), a `constraints:` entry on a MULTI meta-variable (`$$$NAME`) is silently inert: the rule matches exactly as the bare pattern would, with no error or warning — `{rule:{pattern:'log.error($$$ARGS)'}, constraints:{ARGS:{not:{regex:'Totem Error'}}}}` fires on `log.error('Totem Error', msg)` just like the unconstrained pattern. Only single meta-variables (`$FIRST`, `$SRC`) are constrained, and changing the pattern to bind one (`log.error($FIRST, $$$REST)`) changes the arity it matches. Measured in the R14 round (mmnto-ai/totem-strategy#288) — the construct the translator had named as the missing one for two rules would not have expressed the intent even if V1 had grafted it; the intent IS expressible as tree-form `all:` + `not:`/`regex:` or `has: {field: arguments, …}`. Never assume a constraint on `$$$` does anything without a probe; fail-loud candidate tracked as mmnto-ai/totem#2667.

**Source:** mcp (added at 2026-08-22T05:59:42.952Z)
