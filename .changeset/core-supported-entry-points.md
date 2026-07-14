---
'@mmnto/totem': minor
---

feat(core): supported subpath entry points over the legacy `@mmnto/totem` barrel (mmnto-ai/totem#2336 — ADR-084 / Proposal 294).

`packages/core/src/index.ts` is a 1,167-line barrel that, as a public surface, makes no per-symbol semver promise — consumers can't tell which exports are contract and which are lab. This mints a small, curated, semver-tracked surface ALONGSIDE the barrel via `package.json` `exports` subpaths (each a thin `tsc`-built aggregator re-exporting a subset already public on the root barrel). The barrel is unchanged (zero removals, zero reordering) and marked legacy/compatibility in prose; subtraction is deferred to a future major.

New supported entry points:

- `@mmnto/totem/config` — `TotemConfig` + the config-schema surface (schemas, tiers, defaults). This is the one hard cross-repo cohort contract: the only barrel import cohort repos take today is `import type { TotemConfig } from '@mmnto/totem'`.
- `@mmnto/totem/packs` — `PackRegistrationAPI`, `loadInstalledPacks`, `loadedPacks`, `isEngineSealed`, `resolveEngineVersion`, and the `installed-packs.json` manifest schema/type (ADR-097 § 5 Q5 / § 10, ADR-099 semver surfaces; the entry third-party packs bind to).
- `@mmnto/totem/lessons` — lesson read/write, ADR-070 frontmatter parse/build, the lesson role + frontmatter schema contracts, the role-applicability filter, and the retirement ledger (bounded — not the frozen rule compiler).
- `@mmnto/totem/artifacts` — the Prop 302 verdict-artifact schema, the content-address-verified loader, the schema-version constants, and the derived settle/cache + lineage helpers.

Consumer-impact: additive package exports only. Four new `@mmnto/totem/*` subpath entries are added to the `exports` map; the root `.` barrel is byte-compatible (unchanged `import`/`types` targets, no symbols removed or reordered). No obligated consumer move — existing `import … from '@mmnto/totem'` is unaffected, and consumers MAY migrate to the narrower subpaths at their own pace. `@mmnto/cli` and `@mmnto/mcp` version-bump alongside `@mmnto/totem` via the changesets `fixed` group but ship no behavior change.
