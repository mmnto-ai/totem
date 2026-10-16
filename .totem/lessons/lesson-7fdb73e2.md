## Lesson — A record lowered under R4 still blocks the pre-push lint

**Tags:** lint, r4, severity, gate-5, pre-push, totem-context, datum

**Applies-to:** infrastructure

A record lowered under R4 still blocks the pre-push lint at its legacy severity until the record route serves. On the first fold push of mmnto-ai/totem#3084 (2026-10-14, about 23:28Z to 23:31Z) the Tenet 4 catch rule — record 2095327f92d4e486 from lesson-87aff037d7de47a7, one of the two R4 lowering hashes whose records read `warning` — blocked at `error` on a catch that does not swallow (it reports and rethrows the read outcome), because `totem lint` reads the compiled legacy row, not the record, while the compile freeze stands. Resolved by a `// totem-context:` directive on the line the engine reads (the last line inside the try for a catch_clause, or the line before the match), no code change. The datum is on mmnto-ai/totem#3044 (comment 6181589891) as precision evidence for the lift ruling's Q1 (a′): one true-positive block the lowering would have let through as a warning. Cite lesson-907267a4 for the blocking predicate.

**Source:** mcp (added at 2026-10-16T00:50:01.943Z)
