---
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/cli': minor
---

feat(core+mcp+skills): orchestration resolver + extractor swap + signoff skill (Proposal 282 / ADR-106 Phase 4 PR A)

Ships the totem-Claude impl-lane slice of [mmnto-ai/totem-strategy#341](https://github.com/mmnto-ai/totem-strategy/pull/341) (Proposal 282 — Local-Only Orchestration, accepted) per the Phase 4 dispatch at `mmnto-ai/totem-substrate:.handoff/totem-claude/processed/2026-05-17T0929Z-strategy-claude.md`. Substrate stays mounted as a frozen archive for forensic reads; new inter-agent coordination flows through per-repo paths.

**New `@mmnto/totem` exports:** `resolveOrchestrationPaths` and the `OrchestrationPaths` discriminated-union type. The resolver returns `{ outbox, processed, journal, source }` for a given `(repoRoot, agentId)`, where each path field is the absolute path to that subdir or `null` when it doesn't exist. `source: 'orchestration' | 'none'` is the precedence-chain signal — orchestration when at least one subdir exists, none otherwise. Same purity stance as `resolveStrategyRoot` / `resolveSubstratePaths`: no caching, no side effects, no logging.

**Additive sibling.** `resolveSubstratePaths` stays live for frozen-archive reads; the two resolvers run in parallel through and after the cohort cutover so downstream consumers can migrate independently. No removal of substrate-resolver code in Phase 4.

**Path-traversal guard.** `resolveOrchestrationPaths` validates `agentId` against `/[/\\\0]|\.\./` before composing the base path. The hardcoded map in the `/signoff` skill is safe, but the `.totem/orchestration/config.json` `host_agents` override is repo-controlled input; a malicious or buggy override (`'..', '../..', 'a/b'`) would otherwise escape `.totem/orchestration/` after `path.normalize` collapses `..` segments. Invalid input returns `source: 'none'` with all paths null — same shape as a missing tree, callers already tolerate that branch.

**`@mmnto/mcp` extractor swap.** `extractStrategyPointer` now reads orchestration first (the active write target post-Phase-2 migration), falling back to substrate when orchestration is empty across both strategy agents (frozen-archive layer for historical journals). Cross-agent merge uses hybrid sort: filename within an agent's directory (same `<model>-NNNN-*` prefix is monotonic by session counter, cheap), then mtime tiebreak across agents on each agent's latest. The naive alphabetical sort across `claude-*`/`gemini-*` prefixes always puts gemini last regardless of write time and was caught by local shield review pre-merge.

**`@mmnto/cli` signoff skill.** `SIGNOFF_SKILL_CONTENT` in `init-templates.ts` rewrites the procedure for post-Proposal-282 reality: hardcoded agent-id map (cohort-wide; override hook via `.totem/orchestration/config.json` `host_agents`), `resolveOrchestrationPaths` path discovery, null-source manual-mkdir prose, gitignore-aware no-commit/no-push flow. Source-of-truth for the skill is `.claude/skills/signoff/SKILL.md` with the `installed-skills-match-source.test.ts` invariant locking template content against the source file.

**Tests.** Resolver: 18 tests covering presence permutations (none / partial / full / multi-agent / cross-repo), path normalization, file-in-place-of-subdir, and 6 agentId validation cases (empty / `..` / `/` / `\\` / null byte / non-string). State-extractor: 7 new tests covering orchestration-vs-substrate precedence, single-agent-only, both-agents-populated mtime semantics, and cross-agent mtime tiebreak. Full sweep: 1976 `@mmnto/totem` + 151 `@mmnto/mcp` + 2192 `@mmnto/cli` tests green.

**Sequencing.** Phase 4 PR A is the first of three: PR A (this — bundled impl) → PR B (`mmnto-ai/totem-status` dashboard repoint, Go side) → PR C (cohort version bump). The cutover broadcast (last substrate write) is strategy-Claude's lane gated on all three landing.
