## Lesson — TRAP corrected (mmnto-ai/totem#2917, 2026-09-21)

**Tags:** node, exports-map, package-json, trap, cohort-sync, freeze

**Applies-to:** infrastructure

TRAP corrected (mmnto-ai/totem#2917, 2026-09-21): `require.resolve('<pkg>/package.json')` and `import.meta.resolve('<pkg>/package.json')` throw ERR_PACKAGE_PATH_NOT_EXPORTED when the package's exports map OMITS the `./package.json` subpath. The map's conditions are not the cause: a map with no `import` condition resolves the specifier when the key is present, and an import-only map refuses it when the key is absent (measured on @mmnto/pack-rust-architecture against cli, totem and mcp at 2.9.1). Since @mmnto/cli 2.9.2 every published @mmnto/* map carries `"./package.json": "./package.json"` and `packages/core/src/published-exports-lock.test.ts` keeps it so, so the package specifier is the right read for cohort packages; walk node_modules by path only for a third-party package whose map omits the key. The compile-input lesson-379fc29e states the wrong mechanism (an import-only condition) and the now-stale advice; its rewrite is owed at unfreeze, since the compile freeze forbids editing compile-input lessons, and this index-only lesson carries the corrected rule until then.

**Source:** mcp (added at 2026-09-21T18:39:41.249Z)
