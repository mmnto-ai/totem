---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

fix(doctor): resolve the cohort floor for strategy-published parity rows + sharpen the optional-pin WARN hint (#2108, #2094)

`resolveCohortFloor` (core `parity-detect.ts`) previously probed only totem-shaped floor sources — self-in-tree and the `../totem` sibling — so a _strategy_-published package like `@mmnto/strategy-doctrine` was honest-absent by construction and its `version-pinned` row verdicted `SKIP` instead of the consumer-side `pass`/`warn`. It now adds a canonical-source-repo probe: when the contract's `canonicalSource` names `totem-strategy`, the floor is resolved from that repo's `packages/*` by reusing `resolveStrategyRoot` (env / config / `../totem-strategy` sibling — still NEVER networks, never throws, honest-absent on miss). The honest-absent remediation also stops recommending `../totem` for a package totem doesn't publish (#2108).

The `doctor --parity` configured-but-missing WARN hint now names the install-side cause when the configured manifest path lives under `node_modules/` (the strategy-doctrine optional-pin shape): the expected unauthed-CI state is "optional dep skipped at install (npm read-auth required)", not a misconfigured path (#2094).
