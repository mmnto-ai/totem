---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

Resolve the `totem ecl-gc --compact` A2.2 completeness roster from consumer config, and **retire the interim `cohortRepos()` core export** (mmnto-ai/totem#2310; contract ADR-106 § A2.2 + `ecl-discipline` § 4.5; roster ruling by strategy-claude on the issue).

**New config surface — `ecl.cohortRepos`.** `TotemConfigSchema` gains an optional `ecl` sub-schema (`EclConfigSchema`) whose `cohortRepos: string[]` declares the cohort repos whose ECL outboxes a "provably-complete" poll must scan before a processed-mark may be collected. Values are bare workspace **directory** names (e.g. `totem`, `totem-strategy`), matched against the workspace root's siblings — not `owner/repo` slugs. This is **consumer-declared** config, not a baked product identity: `totem ecl-gc` ships, so an external consumer's cohort is THEIR repos (Tenet 16). Change-authority for our cohort's value stays mmnto-ai/totem-strategy#611.

**Precedence** (mmnto-ai/totem#2310): an explicit `EclCompactOptions.expectedRepos` (programmatic callers / tests) wins over `config.ecl.cohortRepos`; when both are absent the roster is **undeclared** and compaction hard-aborts (`gateComplete=false`, exit 3, **not** `--force-incomplete`-waivable) — unchanged from the shipped no-roster arm. The CLI action reads config at the process boundary (`loadEclConfig`) and injects it, keeping `eclCompact` a pure, synchronously-testable function.

**Empty array is a loud config error, not "undeclared."** `cohortRepos: []` violates Zod `.min(1)` and fails at config load; the ecl-gc path surfaces it loudly (exit 2) and never degrades a config bug into the undeclared gate-red arm (the config read narrows its swallow to `CONFIG_MISSING` only). A genuine single-repo consumer declares a roster of one (completeness-1).

**BREAKING for the one-release-old interim export.** `@mmnto/totem` no longer exports `cohortRepos()`. It shipped in 1.90.0 explicitly marked **INTERIM / product-locked / do-not-depend** with config-ification tracked in this issue, so its removal is expected — but consumers on 1.90.0 that imported it must switch to the `ecl.cohortRepos` config surface (or pass `expectedRepos` programmatically). No other public surface changes; prune behavior (`totem ecl-gc` without `--compact`) is untouched.
