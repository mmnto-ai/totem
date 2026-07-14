/**
 * `@mmnto/totem/packs` — supported pack-discovery entry point.
 *
 * Curated, semver-tracked re-export of the pack registration + load surface
 * ADR-097 (§ 5 Q5, § 10) and ADR-099 classify as true semver contracts: the
 * `PackRegistrationAPI` a pack's `register` callback receives, the boot-time
 * `loadInstalledPacks()` loader, the sealed-engine predicates, and the
 * `installed-packs.json` manifest schema/type. Third-party packs bind to this
 * surface, so it carries the most external weight of the supported entries.
 *
 * Every name here is also re-exported from the legacy root barrel (`.`).
 * Scope is deliberately the `pack-discovery` module only: the manifest
 * *writer* (`resolveInstalledPacks` / `writeInstalledPacksManifest`) and the
 * stale-manifest detector are `totem sync` producer internals, not the pack
 * registration contract, and stay off this surface pending a first external
 * consumer. Test-only helpers (`__resetForTests`) are never exported here.
 *
 * Additive per mmnto-ai/totem#2336 (ADR-084 / Proposal 294). The root barrel
 * is unchanged; nothing is removed from it in this cut.
 */

// Registration + load + manifest types.
export type {
  InstalledPacksManifest,
  LoadedPack,
  LoadInstalledPacksOptions,
  PackRegisterCallback,
  PackRegistrationAPI,
} from './pack-discovery.js';

// Manifest schema, loader, engine-seal predicates, and engine-version resolver.
export {
  InstalledPacksManifestSchema,
  isEngineSealed,
  loadedPacks,
  loadInstalledPacks,
  resolveEngineVersion,
} from './pack-discovery.js';
