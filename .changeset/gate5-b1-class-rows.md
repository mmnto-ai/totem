---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

The authored whitelist (`packages/cli/src/commands/authored-whitelist.ts`) gains the Gate 5 batch-1 class set: five `(ast-grep, structuralClass)` rows delivered as data by the scorer (strategy-claude's dispatch of 2026-09-24T00:28:55Z, set `gate5-2263305c` batch 1) — `forbidden-callee-call`, `static-import-from-module`, `catch-without-rethrow`, `type-assertion-on-call`, `forbidden-constructor-throw`, in that order. Ten registry rows with the shipped five; no class name repeats and none sits under two engines, so the predicate's exactly-one match and the load-time duplicate guard both hold. The set id is `static-whitelist@gate5-6cba5706`: the first 8 hex of the sha256 over ONE compact JSON array of the five rows in committed order (`JSON.stringify` of `{ engine, structuralClass }` objects, key order engine then structuralClass, no whitespace, no trailing newline; the dispatch's pretty-printed block is not the input). The batch-1 intake pin passes it as `--judged-by` explicitly, and a unit test pins the rows, their order, their position after the shipped five and the id. Data only: no mechanism, option, output format or default (`static-whitelist@cert-1`) changes; an envelope entry declaring one of the five pairs is now decidable (minted) where it was rejected with exit 1.
