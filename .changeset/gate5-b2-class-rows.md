---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

The authored whitelist (`packages/cli/src/commands/authored-whitelist.ts`) gains the Gate 5 batch-2 class set: two `(ast-grep, structuralClass)` rows delivered as data by the scorer (strategy-claude's dispatch of 2026-09-27T21:35:02Z, set `gate5-2263305c` batch 2) — `forbidden-fixed-call-expression`, `callee-call-without-argument`, in that order, appended after batch 1's five. Twelve registry rows with the shipped ten; no class name repeats and none sits under two engines, so the predicate's exactly-one match and the load-time duplicate guard both hold. The set id is `static-whitelist@gate5-9668b633`: the first 8 hex of the sha256 over ONE compact JSON array of THESE TWO rows in committed order (`JSON.stringify` of `{ engine, structuralClass }` objects, key order engine then structuralClass, no whitespace, no trailing newline) — the batch's own slice, never the union with batch 1, because each batch's rows ride their own patch; batch 1's id `static-whitelist@gate5-6cba5706` is unchanged. The batch-2 intake pin passes it as `--judged-by` explicitly, and the unit tests pin both slices, their order, both ids, the ast-grep typing of every delivered row, pair and class-name uniqueness and frozenness. Two comment corrections ride with the rows: the header's claim that a class listed under two engines is "AMBIGUOUS ⇒ non-decidable" was false of the shipped predicate, which keys on the pair (what refuses such a class is rule 2's policy and the test's class-name limb), and the table doc now records that engine typing is read MODAL at the class level from batch 2 on (D7 = (a)). Data and comments only: no mechanism, option, output format or default (`static-whitelist@cert-1`) changes; an envelope entry declaring one of the two pairs is now decidable (minted) where it was rejected with exit 1.
