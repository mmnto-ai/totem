---
'@mmnto/cli': patch
---

Advisory-ize the frozen-lesson regex rule class in the local pre-push `totem lint` gate via an engine-type split. Regex-engine compiled-lesson rules are now advisory — printed, but excluded from the exit-1 tally regardless of severity — while `ast`/`ast-grep` structural rules stay hard-blocking. This stops the frozen-lesson false-positive flood (un-recompilable under the rule-compilation freeze) that was forcing `--no-verify` on every push, matching the advisory posture already applied to the CI Totem Lint job (#2181, #2182).
