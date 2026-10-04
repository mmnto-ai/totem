## Lesson — Pre-push lint blocks only on a hard-tier error rule

**Tags:** lint, enforcement, pre-push, ci, freeze, correction

**Applies-to:** infrastructure

Pre-push lint blocks only on a hard-tier error rule. This corrects lesson-a11f6d21, which says of this repository's compiled-rules lint that "the run that blocks is the pre-push hook". The hook does exit 1 when `totem lint` fails, but lint fails only on a blocking finding, and `packages/cli/src/commands/run-compiled-rules.ts` (lines 834 to 842 on main at 57e9af5d) defines blocking as hard tier AND error severity. Hard tier is `ruleClass === 'hard'` where a rule carries that stamp, and otherwise an `ast` or `ast-grep` engine; an absent severity reads as error. Every regex-engine rule and every warning is printed and left out of the exit code. Measured 2026-10-04 on that commit: 4 of the 385 active compiled rules can block, the four ast-grep error rules, and none carries a `ruleClass`. So while the rule-compilation freeze stands, CI's lint step runs with `continue-on-error` and blocks on nothing, and the hook blocks on those four and reports the other 381. The file of lesson-a11f6d21 keeps its wording until the unfreeze, because the freeze's do-not list covers editing an existing lesson; this index-only lesson carries the corrected statement until then (the operator's ruling of 2026-10-03; the source PR is mmnto-ai/totem#3006, and the correction rides the postmerge for mmnto-ai/totem#3018).

**Source:** mcp (added at 2026-10-04T19:23:42.314Z)
