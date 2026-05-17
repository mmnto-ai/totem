---
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/cli': patch
---

fix(core): harden resolveOrchestrationPaths with path.resolve(repoRoot) — match resolveSubstratePaths absolute-output guarantee

Closes [mmnto-ai/totem#1953](https://github.com/mmnto-ai/totem/issues/1953). Tier-1 follow-up from the GCA review on [mmnto-ai/totem#1952](https://github.com/mmnto-ai/totem/pull/1952) (Phase 4 PR C changeset).

`resolveOrchestrationPaths` (`packages/core/src/orchestration-resolver.ts`) previously trusted the JSDoc contract that callers supply an absolute `repoRoot`. A caller violating the contract by passing a relative path would get relative `outbox` / `processed` / `journal` paths back — a quiet correctness slip rather than a loud error. `resolveSubstratePaths` runs `path.resolve(configRoot)` on its anchor for the same reason; symmetric guarantee now restored.

One-line fix: `const resolvedRoot = path.resolve(repoRoot);` applied before composition, sibling to the existing path-traversal guard. Plus one new test confirming relative `repoRoot` input produces absolute output (parity with the substrate-resolver path-shape contract). 19 resolver tests green.
