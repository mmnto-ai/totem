---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem orient` (both surfaces) renders a repo-local mirror of a cohort freeze as ONE parked entry (mmnto-ai/totem#2937). The PARKED section is the union of `.totem/freeze.json` and the distributed `@mmnto/strategy-doctrine` snapshot, and a repo that keeps an intentional local mirror of the cohort hold (totem does, so CI's manifest attestation sees the freeze without registry auth) printed the one freeze twice: `parked/frozen (2): rule-compilation …, rule-compilation …`. The union itself is unchanged (core's `readEffectiveFreezes` stays undeduplicated by contract; `verify-manifest` and `doctor` read it as such); orient's derivation now folds a local entry whose `id` a cohort entry also carries into that cohort entry, renders the cohort entry's fields, and names both provenances: `rule-compilation (legacy lesson-compile path) [local mirror + cohort@0.1.49]`, count 1. A mirror whose mirror-bound fields (`subsystem`, `since`, `do-not`) differ from the cohort entry is flagged `⚠ local mirror differs (since)`; prose fields (`reason`, `tracking`) are not compared. A local entry whose id the snapshot lacks, or the reverse, stays its own line, and id-less entries never collapse. The JSON report's parked entries gain `id`, `mirroredLocally` and `mirrorDrift` (additive).
