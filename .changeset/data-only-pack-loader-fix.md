---
'@mmnto/totem': patch
---

Fix `pack-discovery` regression that broke loading of data-only packs (workflows + templates only,
no `main`/`exports`/`register.*`) introduced in 1.30.0. `resolvePackCallback` now probes
`require.resolve` before attempting `require()`; on `MODULE_NOT_FOUND` or
`ERR_PACKAGE_PATH_NOT_EXPORTED` it returns a no-op callback so the pack registers as
known-but-data-only without throwing.

Bot Interpretive Packs (`@mmnto/pack-bot-coderabbit`, `@mmnto/pack-bot-gemini-code-assist`)
are intentionally data-only per `docs/wiki/pack-ecosystem.md`. The 1.30.0 loader rewrite
unconditionally `require()`d every pack and threw on these. Restores 1.29-era behavior
for the data-only archetype while leaving code-pack and ESM-pack paths unchanged.

Errors thrown from inside a code pack's entry point (e.g., the pack's `register.cjs`
requires a missing dependency) continue to surface loud — the new try/catch is scoped
to `require.resolve` only.

Closes mmnto-ai/totem#1848.
