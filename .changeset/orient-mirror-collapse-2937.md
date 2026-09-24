---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

`totem orient` (both surfaces) renders the two sources' entries for one freeze as ONE parked line (mmnto-ai/totem#2937). The PARKED section is the union of `.totem/freeze.json` and the distributed `@mmnto/strategy-doctrine` snapshot, and a repo whose local file carries the cohort hold's `id` printed the one freeze twice: on a consumer that keeps a CI-visible local mirror (totem) and on the publisher whose local registry IS the hold the snapshot was cut from (totem-strategy). The union itself is unchanged (core's `readEffectiveFreezes` stays undeduplicated by contract; `verify-manifest` and `doctor` read it as such); orient's derivation folds a local entry whose `id` a cohort entry also carries into one line that names both provenances. Which side renders follows the local entry's own `scope`: on a consumer (`local`) the cohort hold's fields render as `[local mirror + cohort@0.1.49]` (the full surface: `[local mirror + cohort @ strategy-doctrine 0.1.49]`); on the publisher (`cohort`) the local source's fields render as `[local source + cohort@0.1.49]`. The count reads 1. When the two sides differ on a bound field (`subsystem`, `since`, `do-not`, the last compared as a set), the line is flagged `⚠ local mirror differs (since)` on a consumer or `⚠ snapshot differs (since)` on the publisher; prose fields (`reason`, `tracking`) are not compared. A local id the snapshot lacks, or the reverse, stays its own line, and id-less entries never collapse. The JSON report's parked entries gain `id`, `mirroredLocally`, `localRole` and `mirrorDrift` (additive). `totem doctor`'s freeze row still lists both entries with their provenance tags; a follow-up covers it.
