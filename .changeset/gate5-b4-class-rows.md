---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

The authored whitelist (`packages/cli/src/commands/authored-whitelist.ts`) gains the Gate 5 batch-4 class set, the last batch: three `(ast-grep, structuralClass)` rows delivered as data by the scorer (strategy-claude's dispatch of 2026-10-04T19:24:10Z, set `gate5-2263305c` batch 4) — `forbidden-object-member-call`, `named-callee-argument-shape` and `try-block-expect-fail-with-catch`, in that order, appended after batch 3's one. Sixteen registry rows with the shipped thirteen; no class name repeats and none sits under two engines, so the predicate's exactly-one match and the load-time duplicate guard both hold. Each name's breadth is disclosed with its row: a dot-member call only; an object-literal second argument with a constant or a variable first argument, a variable options argument missed; the required call directly in the try block after at least one statement, with a catch that binds a name. Five rules of the batch are kept out of the intake envelope on engine typing and are no rows.

Data and comments only: no mechanism, option, output format or default (`static-whitelist@cert-1`) changes. An envelope entry declaring one of the three `ast-grep` pairs now passes the whitelist predicate (decidable) and goes on through the rest of the intake, where it was rejected at that gate; a `regex` declaration of the same name is rejected as before. The set id is `static-whitelist@gate5-b5bc711a`, the first 8 hex of the sha256 over one compact JSON array of the three rows in committed order; the ids of batches 1 to 3 do not move. The batch-4 intake pin passes it as `--judged-by`. Part of the Gate 5 migration under mmnto-ai/totem-strategy#288; the rows of batches 1 to 3 landed in mmnto-ai/totem#2949, mmnto-ai/totem#2980 and mmnto-ai/totem#2984.
