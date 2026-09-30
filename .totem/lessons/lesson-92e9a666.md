## Lesson — The authored cert-corpus reader binds one run to one judgedBy; a per-batch ledger carries several

**Tags:** certification, ledger, migration
**Scope:** packages/cli/src/commands/spine-authored-cert-corpus.ts

The authored cert-corpus reader derives its `judgedBy` from the authoring ledger and throws `GATE_INVALID` when the ledger records more than one distinct value. The Gate (5) migration admits each batch under its own set id, so the ledger on main carries several by design and that reader would refuse it. This is a disclosed limit, not a defect of an intake pin: no Gate (5) step runs the reader, and the cure is a strategy ruling (per-row `judgedBy` in the corpus, or per-run scoping) tracked on mmnto-ai/totem#2982. A review suggestion to consolidate the envelope, or to restore earlier batches' entries so that one id covers the ledger, is declined on that ground (mmnto-ai/totem#2947, mmnto-ai/totem#2948).
