---
'@mmnto/mcp': patch
---

fix(mcp): raise non-Windows vitest timeout floor 5s → 15s to absorb shared-runner cold-import variability

`packages/mcp/src/ledger-writer.test.ts` uses a `vi.resetModules() + await import('./ledger-writer.js')` pattern in `beforeEach`. Local runs land near 1s for the cold-graph first test (`appends an mcp_call event to events.ndjson with the activity_name`). Under Ubuntu shared-runner CI load (run `25936416424` on the `mmnto-ai/totem#1927` post-merge push), the same test exceeded the 5000ms default and failed, while macOS + Windows in the same run passed.

The Windows branch already bumped its floor to 30s for subprocess-driving slowness. The same shape of variability — cold-graph imports on shared CI hardware — applies to Linux/macOS too; the floor just hadn't been calibrated for it yet. Raising to 15s gives ~15× headroom over the observed local cost without masking real test slowness in the rest of the `@mmnto/mcp` suite.

No runtime code change. Test-config only.
