---
'@mmnto/cli': patch
---

`totem lint`: the frozen-lesson advisory wording (the text note and the SARIF summary line that say regex rules are "sensed-not-enforced under the rule-compilation freeze") is gated on LEGACY regex-class warnings only. Since the S6 regeneration a record-built row is un-stamped too, so a warning from a record regex rule used to set the flag and the output labeled a record-served rule as a frozen lesson; the discriminator now excludes record rows through core's `isRecordPathRule`. The comments that read "un-stamped means legacy", on the discriminator in `run-compiled-rules.ts` and on the tier fallback in core's `rule-tier.ts`, are re-worded; no other behaviour changes.
