---
'@mmnto/totem': patch
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

Promote `sanitizeForTerminal` helper from `@mmnto/cli` to `@mmnto/totem` core (`mmnto-ai/totem#1744`). MCP and other downstream consumers can now import the canonical helper directly from `@mmnto/totem` instead of duplicating the regex inline.

Internal-only refactor: pure file relocation + import-path updates across 5 consumers (4 cli + 1 mcp). The MCP `context.ts` `strategyStatus.reason` rendering now calls `sanitizeForTerminal()` then applies the existing `\n`/`\t` flatten/collapse/trim chain inline (the helper deliberately preserves `\n`/`\t` for callers wanting multi-line content). Tests for the helper move with the source into `packages/core/`.

The `cli/src/utils.ts` re-export of `sanitizeForTerminal` is dropped; consumers now import directly from `@mmnto/totem`. The orchestrator-graph guard in `shield-estimate.test.ts` continues to hold — `@mmnto/totem` core does not transit the orchestrator graph the way `cli/src/utils.ts` does via its static `./orchestrators/orchestrator.js` import.
