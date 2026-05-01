---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-097 § 10 Pack v0.1 substrate bundle (`mmnto-ai/totem#1768`). Bundles three substrate features that gate the Pack v0.1 alpha ship per ADR-097 § 6 Stage 1. PR-B (`@totem/pack-rust-architecture` lift) hard-blocks on this PR.

**`mmnto-ai/totem#1768` — Pack discovery substrate.** New `packages/core/src/pack-discovery.ts` reads `.totem/installed-packs.json` synchronously at engine boot, runs each pack's registration callback with a `PackRegistrationAPI`, then seals both downstream registries before any chunker / language lookup happens. Per ADR-097 § 5 Q5 the boot path MUST be synchronous and MUST NOT walk `node_modules` dynamically.

**Public API additions (exported from `@mmnto/totem`):**

- `loadInstalledPacks(options?: LoadInstalledPacksOptions): readonly LoadedPack[]` — boot-time entry point. CLI commands invoke this immediately after config load. Idempotent only for the first call; second call after seal throws.
- `loadedPacks(): readonly LoadedPack[]` — runtime snapshot of resolved packs.
- `isEngineSealed(): boolean` — true after `loadInstalledPacks` returns.
- `InstalledPacksManifestSchema` — Zod schema for `.totem/installed-packs.json`. Strict (`.passthrough()` rejected); unknown sibling keys fail loud.
- `PackRegistrationAPI` interface — `registerChunkStrategy(name, ctor)` + `registerLanguage(extension, lang, wasmLoader)` are the two callback surfaces.
- `PackRegisterCallback` type — synchronous `(api: PackRegistrationAPI) => void` per ADR-097 Q5.
- `LoadedPack`, `LoadInstalledPacksOptions`, `InstalledPacksManifest` types.

**`mmnto-ai/totem#1769` — ChunkStrategy registry extensibility.** New `packages/core/src/chunkers/chunker-registry.ts` replaces the closed `CHUNKER_MAP` keyed by the closed `ChunkStrategy` Zod enum. Built-in chunkers self-register at module load; pack callbacks add new strategies via `registerChunkStrategy`. The registry rejects:

- Re-registration of the same strategy name (pack-vs-pack collision).
- Registration of a built-in name (built-ins immutable).
- Any registration after seal.

`ChunkStrategySchema` migrates from `z.enum([...])` to `z.string().refine()` against the registry. The error message lists the registered set so misconfigured strategy names are diagnosable. `ChunkStrategy` type alias keeps the literal union of built-in names + adds `(string & {})` so IntelliSense survives in core code paths while pack-contributed strategies type-check.

This supersedes `mmnto-ai/totem#1537` (which proposed adding `'rust-ast'` directly to the closed enum) — close `#1537` once PR-B (`@totem/pack-rust-architecture`) lands and registers `'rust-ast'` via the pack-side callback.

**`mmnto-ai/totem#1653` — ast-grep `Lang` registration substrate (registry-backed reframe).** `packages/core/src/ast-classifier.ts` `extensionToLanguage` migrates from a hardcoded `switch` to a `Map`-backed registry. Built-in extensions (`.ts/.tsx/.jsx/.js/.mjs/.cjs`) self-register at module load; pack callbacks add new (extension, SupportedLanguage, wasmLoader) triples. `loadGrammar(lang)` consults the registry for the WASM loader thunk and memoizes the resolved grammar.

`SupportedLanguage` type alias widens to `'typescript' | 'tsx' | 'javascript' | (string & {})` per the ADR-097 § 10 Q1 disposition: built-ins keep IntelliSense, pack-contributed languages flow through as registered strings.

**Behavior change (mmnto-ai/totem#1653 fail-loud):** `applyAstRulesToAdditions` (`packages/core/src/rule-engine.ts:392`) previously silently skipped any file whose extension wasn't in the hardcoded mapping. The silent skip masked rules scoped to unmapped extensions — a `.rs` rule in LC's compiled-rules.json never fired with no signal. The fix is surgical: skip files only when NO rule's `fileGlobs` matches them (no rule cares → silent skip is correct); throw when a rule expected to run but the language isn't registered. Migration: install the pack that provides the language (e.g., `@totem/pack-rust-architecture` once PR-B lands), or correct the rule's `fileGlobs`.

**`mmnto-ai/totem#1654` — compile-pipeline `Lang.Tsx` hardcode (partial fix, ride-along).** `packages/core/src/ast-grep-query.ts` `extensionToLang` migrates to consult the registry. Built-in mappings preserve napi `Lang` enum values (`Lang.TypeScript`, `Lang.Tsx`, `Lang.JavaScript`); pack-contributed languages flow through as their `SupportedLanguage` string per `@ast-grep/napi`'s `NapiLang = Lang | (string & {})` type.

The second `#1654` call site (`packages/core/src/compile-lesson.ts:319` empty-root pattern validator) keeps `Lang.Tsx` for now as the lingua-franca syntactic-shape validator. Migrating that path requires per-rule language detection at validation time; deferred to a sibling PR. The registry shape proven end-to-end via the `extensionToLang` migration is sufficient to demonstrate non-TS rule dispatch.

**Schema deltas:**

- `TotemConfigSchema` gains optional `extends: z.array(z.string().min(1))` — formal validation of the pack-extends mechanism that `totem install` already wrote text-only. Pack-merge logic (`packages/core/src/pack-merge.ts`) reads pack rules; pack discovery (`packages/core/src/pack-discovery.ts`) reads this field plus `package.json` deps and writes the union to `.totem/installed-packs.json`.
- `ChunkStrategySchema` migrates from `z.enum` to `z.string().refine(name => CHUNKER_REGISTRY.has(name), ...)`. Backward compatible at the type level: `ChunkStrategy` keeps the literal union of built-in names with `(string & {})` extension; runtime validation defers to the registry. Old data written before pack registration (all built-ins) parses cleanly.

**`totem sync` integration:**

`syncCommand` now writes `.totem/installed-packs.json` after the standard sync flow. The manifest payload is the deduplicated union of `package.json` `@totem/pack-*` deps and `totem.config.ts` `extends` entries (Q4 disposition). Mismatch surfaces emit per-pack warnings:

- `dep-only`: pack in `package.json` but not in `extends` — pack-merge would never consume it. Skip with warning.
- `extends-only`: pack in `extends` but not installed — engine cannot load it. Skip with warning.
- `not-a-pack`: resolvable package without `peerDependencies['@mmnto/totem']` — doesn't follow the pack contract. Skip with warning.

Resolved entries flow through to a strict-schema-validated manifest. Atomic write via temp file + rename mirrors `writeReviewExtensionsFile` (`mmnto-ai/totem#1527`).

**`peerDependencies['@mmnto/totem']` engine version cross-check:** at boot, every pack's declared range is checked against the running engine version via `semver.satisfies` (per ADR-097 Q6). Mismatch produces a structured error: `"Pack '<name>' requires @mmnto/totem '<range>' but the running engine is <version>"`. Invalid range strings fail loud separately.

**Test additions (50 new tests across 3 new test files):**

- `packages/core/src/chunkers/chunker-registry.test.ts` (11 tests) — built-in registration, pack-style registration, conflict detection, seal contract.
- `packages/core/src/pack-discovery.test.ts` (13 tests) — manifest read paths (missing / malformed / schema-invalid / unknown sibling keys), peerDeps mismatch (range fail / valid range pass / invalid range), re-load after seal, callback execution + registration, two-packs collision detection.
- `packages/core/src/pack-manifest-writer.test.ts` (9 tests) — Q4 deduplication semantics, warning emission, atomic write, schema validity.
- `packages/core/src/ast-classifier.test.ts` (extended +14 tests) — language registry built-ins, pack-style language registration, seal contract.
- `packages/core/src/rule-engine.test.ts` (extended +3 tests) — `mmnto-ai/totem#1653` fail-loud behavior change: throws when rule scopes to unmapped extension; silent-skip preserved when no rule cares; unscoped rules don't trigger fail-loud.

**Dependencies:**

- `semver: ^7.7.0` added to `@mmnto/totem` dependencies for the engine version cross-check (per ADR-097 Q6). `@types/semver` to devDependencies.

**PR cascade:**

- This PR (PR-A) ships the substrate.
- PR-B (`@totem/pack-rust-architecture` lift from `audits/internal/2026-04-30-pack-v0.1-draft/` to `packages/pack-rust-architecture/`) hard-blocks on this PR. PR-B authors the registration callback, ships `tree-sitter-rust.wasm`, and registers `'rust-ast'` ChunkStrategy + `.rs → 'rust'` Lang.
- PR-C (LC adoption) follows post-PR-B.
