---
'@mmnto/cli': minor
---

Wire pack registration into CLI command boot sequence (ADR-097 § 10).

Closes mmnto-ai/totem#1794. Adds a `bootstrapEngine(config, projectRoot)` helper invoked by `lint`, `shield`, `compile`, and `test-rules` immediately after `loadConfig`. The helper calls `loadInstalledPacks()` so pack-contributed languages, chunkers, and grammars register before any AST rule dispatch — fulfilling the contract documented in `pack-discovery.ts` and `.totem/specs/pack-substrate-bundle.md` since 1.22.0 but never invoked from a CLI surface.

Idempotent within one Node process via `isEngineSealed()`, so test harnesses running multiple commands in sequence do not throw "engine sealed". Production CLI invocations are fresh processes, so single-shot seal is the production path.

**Closes the Pack v0.1 substrate-wiring gap end-to-end.** Downstream consumers extending their `totem.config.ts` with `extends: ['@mmnto/pack-<lang>-architecture']` now see pack callbacks actually fire. Unblocks ADR-097 Stage 1 alpha-pilot graduation gate and the Liquid City PR-C cascade. The pre-existing engine-side substrate (PR-A, 1.22.0) and the pilot pack (PR-B, 1.23.0) are now reachable end-to-end from `totem lint` for the first time.

No core API changes — `isEngineSealed` and `loadInstalledPacks` were already exported; this PR adds only the CLI-side invocation.
