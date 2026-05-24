---
'@mmnto/cli': patch
---

chore(deps): bump packageManager pnpm@9.15.4 -> pnpm@11.2.2 (W4 cohort dep wave)

Lifts the repo's `packageManager` field from `pnpm@9.15.4` to `pnpm@11.2.2`, migrates the pnpm 11-canonical settings home from `package.json` to `pnpm-workspace.yaml`, and deletes `.npmrc` (single-line `engine-strict=true` superseded by `engineStrict: true` in workspace config).

## What ships

| Change                          | Before                             | After                                                                                                                 |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `package.json` `packageManager` | `pnpm@9.15.4`                      | `pnpm@11.2.2+sha512.<corepack integrity>`                                                                             |
| `pnpm-workspace.yaml`           | `packages:` only                   | `engineStrict: true` + `strictDepBuilds: true` + `allowBuilds` map + `minimumReleaseAge` + `minimumReleaseAgeExclude` |
| `.npmrc`                        | `engine-strict=true` (single line) | deleted                                                                                                               |
| `pnpm-lock.yaml`                | `lockfileVersion: '9.0'`           | `lockfileVersion: '9.0'` (pnpm 11 reads v9 lockfiles natively; no regen forced)                                       |

## pnpm 11 settings home migration

pnpm 11 dropped reading the `pnpm.*` field from `package.json` entirely; the canonical settings home is now `pnpm-workspace.yaml`. The five settings landed in this PR:

- `engineStrict: true` — migrated from `.npmrc engine-strict=true`. Fails workspace install when active Node doesn't satisfy `engines.node` (W3 cohort constraint at `>=24`).
- `strictDepBuilds: true` — pnpm 11 default; fails install on unapproved transitive `postinstall`/`install` scripts. Companion to `allowBuilds`.
- `allowBuilds` — map of approved transitive packages that may run install/build scripts. Six packages enumerated (ast-grep/lang-rust, es5-ext, esbuild, protobufjs, tree-sitter-javascript, tree-sitter-typescript). Source: empirical CI iteration enumerated the eight version-pinned variants needing approval; collapsed to six name-keyed entries per pnpm docs' canonical form.
- `minimumReleaseAge: 1d` — pnpm 11 default; blocks install of packages published less than 24h ago for supply-chain hygiene against immediate-publish attacks.
- `minimumReleaseAgeExclude: ['@mmnto/*']` — cohort carve-out. Cohort packages publish-then-install in the same CI window by design; the 1d hygiene gate breaks that loop for `@mmnto/*` but stays in force for all third-party transitive deps.

## Workflow surface unchanged

All 7 workflows (`ci`, `ci-integration`, `compile-manifest`, `lint`, `release`, `release-binary`, `totem-doctor`) remain on `pnpm/action-setup@v5` with no `version:` input — the pnpm release is inferred from `packageManager`. The `pnpm/action-setup@v6` line has open inference bugs (`pnpm/action-setup#225`, `#227`) that would have forced an explicit `version: 11.2.2` pin; staying on `@v5` keeps the inference path clean and `packageManager` as the single source of truth.

## Cross-stream coordination

pnpm 11 reads pnpm 9-generated lockfiles cleanly (forward direction; verified empirically). The reverse direction — pnpm 9 reading a pnpm 11-regenerated lockfile — is the cross-stream consumer risk for cohort dependents (liquid-city, totem-status, arhgap11). At merge time a cohort heads-up dispatches the lockfile-format constraint so dependents can bump pnpm in lockstep if they regenerate lockfiles locally.

## Lockfile compatibility note

This PR does NOT regenerate `pnpm-lock.yaml` to a v11-canonical format. pnpm 11 read the existing v9-format lockfile cleanly across all three OSes (`Lockfile is up to date, resolution step is skipped` per the CI log). A v11 regen will happen organically on the next install that produces a resolution diff.

## Why this is a PATCH bump

W4 is a build-tooling change with no published-package API surface delta. Downstream consumers of `@mmnto/cli`, `@mmnto/totem`, `@mmnto/mcp`, `@mmnto/pack-rust-architecture` (and the private `@mmnto/pack-agent-security`) install from npm tarballs and don't see this repo's `packageManager` field or `pnpm-workspace.yaml`. The bump is invisible to library consumers; cohort-dependent repos with their own lockfile regen are addressed via the cross-stream coordination dispatch above.
