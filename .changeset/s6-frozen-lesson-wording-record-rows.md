---
'@mmnto/cli': patch
---

`totem lint`: the frozen-lesson advisory wording (the text note and the SARIF summary line that say regex rules are "sensed-not-enforced under the rule-compilation freeze") is gated on LEGACY regex-class warnings only. Since the S6 regeneration a record-built row is un-stamped too, so a warning from a record regex rule used to set the flag and the output labeled a record-served rule as a frozen lesson; the discriminator now excludes record rows through core's `isRecordPathRule`. Comments in `rule-tier.ts` and `record-runtime.ts` that read "un-stamped means legacy" are re-worded; no behaviour change there.
