---
'@mmnto/cli': minor
---

chore(engines): declare engines.node across cohort + .npmrc engine-strict (W3 cohort dep wave)

Adds explicit `engines.node` constraints to all five cohort package.jsons and enables `engine-strict=true` in the repo `.npmrc` so pnpm install fails loudly when the active Node doesn't satisfy the cohort's minimum.

## What ships

| Package                         | engines.node | Why                                                                                                                                                                                           |
| ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mmnto/cli`                    | `>=24`       | The publish workflow pinned Node 24 in [`mmnto-ai/totem#1991`](https://github.com/mmnto-ai/totem/pull/1991) (needs bundled npm 11.x for OIDC); CLI surface built + tested on that same floor. |
| `@mmnto/mcp`                    | `>=24`       | Matches CLI surface — MCP server is a sibling runtime.                                                                                                                                        |
| `@mmnto/totem`                  | `>=24`       | Matches CI floor — declared compatibility must equal tested compatibility. See § Cohort tightened to single Node floor below.                                                                 |
| `@mmnto/pack-rust-architecture` | `>=24`       | Matches CI floor — same anchored-claim discipline as core.                                                                                                                                    |
| `@mmnto/pack-agent-security`    | `>=24`       | Matches CI floor (`private: true`; symmetric coverage for workspace engine-strict gate).                                                                                                      |

Plus `.npmrc engine-strict=true` so a workspace install on the wrong Node version fails with `ERR_PNPM_UNSUPPORTED_ENGINE` per Tenet 4 Fail Loud, instead of silently producing a half-installed tree.

## CI workflow Node version aligned

Six CI workflows were on Node 20 or 22, below the cohort's new minimums. Bumped to Node 24 in the same PR so every CI job can satisfy the engines.node constraints it now enforces (the engines.node minimum can't precede the CI floor — workspace install would fail with `ERR_PNPM_UNSUPPORTED_ENGINE` otherwise, as the first push of this branch did across all 3 platforms):

| Workflow                | Before | After |
| ----------------------- | ------ | ----- |
| `ci.yml` (Build & Lint) | 20     | 24    |
| `ci-integration.yml`    | 20     | 24    |
| `compile-manifest.yml`  | 20     | 24    |
| `lint.yml` (Totem Lint) | 22     | 24    |
| `release-binary.yml`    | 22     | 24    |
| `totem-doctor.yml`      | 22     | 24    |

`release.yml` (the OIDC publish workflow) was already on Node 24 from [`mmnto-ai/totem#1991`](https://github.com/mmnto-ai/totem/pull/1991) and is unchanged.

## Cohort tightened to single Node floor

Initial drafts of this PR landed `@mmnto/totem`, `@mmnto/pack-rust-architecture`, and `@mmnto/pack-agent-security` at `>=22` under the framing "library — allows Node 22 LTS consumers." That framing was aspirational — it presupposed downstream-isolated library consumers who consume `@mmnto/totem` outside the cli/mcp surface and need Node 22 LTS support. Cross-stream review with `strategy-claude` walked the candidate-load-bearing scenarios:

| Scenario                                                                    | Status                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Cohort packages consume `@mmnto/totem` as a library on Node 22              | No — cohort consumption is via cli/mcp surface, both already `>=24`                                                                  |
| External enterprise consumer on Node 22 LTS using `@mmnto/totem` standalone | None visible; not a tracked commitment in any current ADR or Proposal                                                                |
| Aspirational future "publish-as-standalone-library" goal                    | Not in any current ADR / Proposal / accepted-status doc                                                                              |
| LTS floor convention for npm publishing hygiene                             | Convention only — and conventions without test coverage are exactly the unanchored-claim pattern this PR's discipline argues against |

CR + GCA review independently surfaced this gap (PR #2013 R1, `df1a141d`): "@mmnto/totem declares engines.node >= 22, but CI floor is now 24 across all jobs. The runtime APIs work down to 22 — that's an unanchored claim. No CI leg validates it." Two bots, independent path, same finding. Strong signal.

Resolved by lifting all three `>=22` packages to `>=24`. Single cohort Node floor; declared compatibility now matches tested compatibility. If a standalone-library consumer on Node 22 LTS emerges later with concrete asks, lift the floor back to `>=22` AND add the Node 22 matrix leg at that point — don't pay CI complexity speculatively.

## Why this is a MINOR bump

Adding a minimum-Node constraint is technically a breaking change for any consumer on an older Node version. Per cohort convention from prior 1.4x cycles, engines bumps ship as MINOR (additive constraint surfaced via the version bump) rather than MAJOR, since they don't change package API surface. Consumers pinned to `^1.x` and on a satisfying Node version are unaffected.

## Runtime-vs-build-tool note on release-binary.yml

`release-binary.yml`'s Node 24 bump in this PR gates the `pnpm install --frozen-lockfile` step only — the Bun cross-compilation steps that follow are entirely independent of the Node version. Per CR R1 observation: the Node version does not affect binary output; it only gates the install step. Documented here so the CHANGELOG body for 1.48.0 carries the rationale.

## Defect-fix discovered during cherry-pick

Original W3 checkpoint at `4dd5af79` (parked local) added a fresh `engines: { node: ">=22" }` block to `packages/pack-rust-architecture/package.json` without merging into the file's existing `engines: { "@mmnto/totem": "^1.26.0" }` block. Duplicate JSON keys are implementation-defined; pnpm/npm take the last occurrence, which would have silently dropped the `node` constraint. Empirical "test passed on Node 22" claim in the original checkpoint was masked by `@mmnto/cli`'s `>=24` failing first across the workspace.

Fixed by merging the two engines blocks into one — single block, both `node` and `@mmnto/totem` fields (initially at `node: ">=22"`, later lifted to `">=24"` per § Cohort tightened to single Node floor above).

## Symmetric coverage on pack-agent-security

Original W3 plan named 4 packages (cli, mcp, core, pack-rust). pack-agent-security has the same single-engines-block structure with `@mmnto/totem` constraint only, no `node` field. Included for symmetric workspace-install gate coverage; pack is `private: true` so no downstream consumer impact, but local dev workflows benefit from the engine-strict enforcement.

## Discipline-anchor exhibit (Tenet 4 working as advertised)

This PR's R-walk surfaced two distinct `feedback_contract_claims_must_anchor_to_canonical_code` violations that the engine-strict mechanism caught in succession — the same mechanism this PR ships:

1. **Initial push at `0fa16fdb`:** The changeset asserted `@mmnto/cli`'s `engines.node = ">=24"` "matches the CI runner pin from #1991." #1991 only bumped `release.yml` (publish workflow); the general CI was still on Node 20 or 22. Cross-platform CI failed loud with `ERR_PNPM_UNSUPPORTED_ENGINE` — the gate enforcing its own discipline on the PR author's anchor-claim violation. Fixed in `df1a141d` (bumped 6 workflows + corrected the changeset prose).
2. **Post-fix at `df1a141d`:** CR + GCA independently converged on the same finding at a different altitude — declared support for `>=22` on `@mmnto/totem` + the two packs, while CI tested only on Node 24. Same anchor-claim pattern. Fixed in the follow-on commit by lifting all `>=22` packages to `>=24`.

Both violations were caught — once by CI (engine-strict directly), once by bot R-walk (engine-strict's discipline-pattern applied to the next-altitude untested claim). The mechanism IS the safeguard. This is exactly the "Sensors fail loud and fast" pattern from `design-tenets.md` Tenet 4 working as advertised in a recursive way: the very gate being shipped enforced its own discipline on the PR's author at write-time.

Banked as the N+1 anchor on `feedback_contract_claims_must_anchor_to_canonical_code` per cohort convention.

## Empirical verification

- Active Node: `v24.16.0`
- `pnpm install --frozen-lockfile` succeeds clean post-fix (all 5 `engines.node` constraints satisfied)
- Parser verification confirms single `engines` block per package with expected fields
