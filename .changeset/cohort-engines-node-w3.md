---
'@mmnto/cli': minor
---

chore(engines): declare engines.node across cohort + .npmrc engine-strict (W3 cohort dep wave)

Adds explicit `engines.node` constraints to all five cohort package.jsons and enables `engine-strict=true` in the repo `.npmrc` so pnpm install fails loudly when the active Node doesn't satisfy the cohort's minimum.

## What ships

| Package                         | engines.node | Why                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mmnto/cli`                    | `>=24`       | The publish workflow pinned Node 24 in [`mmnto-ai/totem#1991`](https://github.com/mmnto-ai/totem/pull/1991) (needs bundled npm 11.x for OIDC); the CLI surface is built and tested on that same floor. Other CI workflows aligned to Node 24 in this PR — see § CI workflow Node version aligned |
| `@mmnto/mcp`                    | `>=24`       | Matches CLI surface — MCP server is a sibling runtime to the CLI                                                                                                                                                                                                                                 |
| `@mmnto/totem`                  | `>=22`       | Library — allows Node 22 LTS consumers; the runtime APIs work down to 22                                                                                                                                                                                                                         |
| `@mmnto/pack-rust-architecture` | `>=22`       | Library pack — same constraint as `@mmnto/totem`                                                                                                                                                                                                                                                 |
| `@mmnto/pack-agent-security`    | `>=22`       | Library pack (`private: true`) — symmetric coverage for workspace engine-strict gate                                                                                                                                                                                                             |

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

## Why this is a MINOR bump

Adding a minimum-Node constraint is technically a breaking change for any consumer on an older Node version. Per cohort convention from prior 1.4x cycles, engines bumps ship as MINOR (additive constraint surfaced via the version bump) rather than MAJOR, since they don't change package API surface. Consumers pinned to `^1.x` and on a satisfying Node version are unaffected.

## Defect-fix discovered during cherry-pick

Original W3 checkpoint at `4dd5af79` (parked local) added a fresh `engines: { node: ">=22" }` block to `packages/pack-rust-architecture/package.json` without merging into the file's existing `engines: { "@mmnto/totem": "^1.26.0" }` block. Duplicate JSON keys are implementation-defined; pnpm/npm take the last occurrence, which would have silently dropped the `node` constraint. Empirical "test passed on Node 22" claim in the original checkpoint was masked by `@mmnto/cli`'s `>=24` failing first across the workspace.

Fixed by merging the two engines blocks into one — single block, both `node` and `@mmnto/totem` fields. Verified post-fix via Python JSON parser: `engines = {'node': '>=22', '@mmnto/totem': '^1.26.0'}`.

## Symmetric coverage on pack-agent-security

Original W3 plan named 4 packages (cli, mcp, core, pack-rust). pack-agent-security has the same single-engines-block structure with `@mmnto/totem` constraint only, no `node` field. Included for symmetric workspace-install gate coverage; pack is `private: true` so no downstream consumer impact, but local dev workflows benefit from the engine-strict enforcement.

## Empirical verification

- Active Node: `v24.16.0`
- `pnpm install --frozen-lockfile` succeeds clean post-fix (all 5 `engines.node` constraints satisfied)
- Parser verification confirms single `engines` block per package with expected fields
