---
'@mmnto/totem': minor
'@mmnto/mcp': patch
---

Add sediment-aware substrate path resolver for ADR-100 Phase C.

`resolveSubstratePaths(configRoot, opts?)` walks four precedence layers — env (`TOTEM_SUBSTRATE_PATH`) → config (`TotemConfig.substratePath`) → sibling-walk (up to 3 levels from `configRoot` looking for `<parent>/totem-substrate/`) → repo-local sediment (`<configRoot>/.handoff/` and `<configRoot>/.journal/`). Layers 1-3 require full substrate shape (`.git/` + `.handoff/` + `.journal/`) to gate stale empty clones. Layer 4 accepts partial sediment (either dir alone). Returns `{ handoffRoot, journalRoot, source }`; null paths with `source: 'none'` is the ADR-090 graceful-degradation surface.

MCP `extractStrategyPointer` now uses a dual-resolver: `resolveStrategyRoot` for the strategy SHA (still in `mmnto-ai/totem-strategy`) and `resolveSubstratePaths` for the journal lookup (now substrate-preferred per Phase B cutover). The `latestJournal` field semantic is unchanged; the comment at `describe-project.ts:60` describes the new substrate-preferred-with-sediment-fallback resolution.

New public API (`@mmnto/totem`): `resolveSubstratePaths`, types `SubstratePaths` / `SubstrateResolverConfig` / `SubstrateResolverOptions`, plus `TotemConfigSchema.substratePath` (optional string, mirrors `strategyRoot` parse-time validation).

Closes #1820.
