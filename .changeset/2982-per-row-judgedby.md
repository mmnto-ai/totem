---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

The authored cert corpus (`buildAuthoredCertifyingCorpus`, `packages/cli/src/commands/spine-authored-cert-corpus.ts`) now derives `judgedBy` per authoring-ledger row: each rule is re-derived under the `structuralEligibility.judgedBy` its own effective ledger row carries, so a ledger holding one static-whitelist id per Gate 5 batch builds one corpus. The intake's verifyOnly re-derive (`runRuleAuthor`) gains `judgedBy: { fromLedger: true }` for this, which requires `verifyOnly`. An entry with no ledger row is re-derived under a placeholder id that never persists, reads `minted`, and is refused by the unchanged no-mint gate, and the per-record assert-equal compares each record with its own row. The authoring path is unchanged, including one `--judged-by` per `totem rule author` run. This is mmnto-ai/totem#2982, ruled (a) by the operator on 2026-09-30; the record is strategy's `operations/310-migration-preregistration.md`, § 7 record additions of 2026-09-30, second paragraph, item (i). The refusal that is gone: "the authoring-ledger records N distinct judgedBy values … a single cert run binds ONE §3 eligibility check". `runRuleAuthor` is not a public export of `@mmnto/cli` (its `index.ts` does not re-export it), so widening the option is internal.
