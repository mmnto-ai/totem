---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-rust-architecture': patch
---

fix(ci): audit + sweep narrow timing thresholds across packages

Three independent CI flakes hit across three platforms in three hours after the #1928 merge to main, each on a different timing-window assertion:

- **Ubuntu** (`@mmnto/mcp` `ledger-writer.test.ts`): vitest `testTimeout` 5_000ms tripped on cold-import (fixed in #1928).
- **macOS** (`@mmnto/totem` `regex-safety/evaluator.test.ts:97`): `softWarningMs: 1` + 1000 trivial-pattern lines finished <1ms on fast hardware; `softWarningTriggered` assertion flipped false.
- **Windows** (`@mmnto/cli` `run-compiled-rules.test.ts:203`): `RegexEvaluator` `DEFAULT_CONFIG.timeoutMs: 100` tripped at "timeout after 139ms" on a single-line `.sh` corpus — Windows worker thread spawn + IPC + shared-runner scheduling jitter exceeded the budget.

This PR audits and uniformly addresses the class:

**1. Vitest test-runner ceilings (4 configs)** — `packages/{cli,core,pack-agent-security,pack-rust-architecture}/vitest.config.ts` bumped non-Windows floor `5_000` → `15_000` to match the `@mmnto/mcp` precedent set in #1928. Windows stays at 30_000 (subprocess spawn). Comments updated to call out the shared-runner cold-import class explicitly.

**2. `RegexEvaluator` production defaults** (`packages/core/src/regex-safety/evaluator.ts`) — `timeoutMs: 100 → 250`, `softWarningMs: 50 → 100`. 250ms keeps per-rule budget snappy in production while giving Windows worker IPC + CI scheduling ~2× headroom over the observed worst case (139ms). Backward compatible: callers passing explicit config are unaffected; callers using defaults gain headroom.

**3. Soft-warning wall-clock test** (`packages/core/src/regex-safety/evaluator.test.ts:92`) — refactored from `softWarningMs: 1` + 1000 lines to `softWarningMs: 5` + 50_000 lines. Same assertion, but 50× wall-clock margin instead of a 1ms threshold racing fast hardware.

No public API change. Verified locally: 2161 `@mmnto/cli` tests + matching cohort across `@mmnto/totem`, `@mmnto/mcp`, and the two packs all green.
