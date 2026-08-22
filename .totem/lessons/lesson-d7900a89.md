## Lesson — A compiled rule can be a DEAD MATCHER: syntactically valid

**Tags:** ast-grep, compiled-rules, dead-matcher, trap, r14-trial, validation

A compiled rule can be a DEAD MATCHER: syntactically valid, compile-green, and structurally unable to ever match. `validateAstGrepPattern` proves PARSEABILITY, not MATCHABILITY — an ast-grep bare-brace object pattern with a LEADING `$$$` metavariable (`{ $$$BEFORE, key: $VAL, $$$AFTER }`) parses as a statement block rather than an object literal and matches zero object nodes, ever. Two of the 485 shipped corpus rules carry this exact shape (`d940b2c9ffe92e99`, and `1a7080ebf6162de3`'s payload), probe-verified during the R14 seed-20 translation: 0/7 candidate snippets matched, while controls (`const $X = {...same...}` and the literal braces) both matched, isolating the cause to the bare-brace + leading-`$$$` form. Detection requires a firing probe (run the pattern against a snippet it MUST match), not a validator. When auditing or authoring compound ast-grep rules: anchor bare object patterns to a surrounding node (assignment, call argument) or probe-verify at authoring time; a wind-tunnel bad-example differential (fires-on-bad) catches this class mechanically — which is exactly what Prop 310's mandatory `examples` exists to force.

**Source:** mcp (added at 2026-08-22T02:01:32.416Z)
