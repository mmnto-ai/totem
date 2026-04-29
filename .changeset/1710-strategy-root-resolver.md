---
'@mmnto/totem': minor
---

feat(core): `resolveStrategyRoot` substrate (mmnto-ai/totem#1710)

Adds a configurable strategy-root resolver to replace the hardcoded
`.strategy/` submodule path. The resolver walks four precedence layers:

1. `TOTEM_STRATEGY_ROOT` env var (with `STRATEGY_ROOT` accepted as a
   legacy alias).
2. `TotemConfig.strategyRoot` field (new optional config field).
3. Sibling clone at `<gitRoot>/../totem-strategy/`.
4. Legacy submodule at `<gitRoot>/.strategy/`.

Each layer must resolve to a real directory (`fs.statSync(...).isDirectory()`)
before it counts; misses fall through. Returns a `StrategyRootStatus`
discriminated union so callers can pattern-match on `resolved` without a
type assertion. Relative env / config values anchor at the git root, not at
deep cwd.

This entry covers the core substrate: resolver + types + config field +
re-exports + unit tests. Programmatic-consumer ports
(`extractStrategyPointer`, `resolveGovernancePaths`, MCP `initContext`
linkedIndexes, bench scripts) and the `StrategyPointerSchema`
discriminated union ship in the same PR via
`1710-strategy-root-consumers.md`.
