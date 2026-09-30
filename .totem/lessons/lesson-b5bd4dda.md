## Lesson — An intake envelope carries the current batch's entries only

**Tags:** intake, ledger, migration
**Scope:** .totem/spine/authored-rules.yaml

`judgedBy` sits inside a ledger row's material hash, so an earlier batch's entry left in the envelope is re-judged under the new set id and appends a `revised` row for an identity that did not change. Each batch's intake runs over an envelope reconciled to that batch's intake-eligible entries: earlier batches' entries out (their rows stand under their own ids), the kept-out rules out, every kept entry byte-identical to its text before (asserted, and dry-proven on a scratch copy first). A review suggestion to restore the earlier entries is declined on this ground (mmnto-ai/totem#2947).
