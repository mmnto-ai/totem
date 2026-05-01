# PR-A: ADR-097 §10 Pack v0.1 Substrate Bundle

Bundled implementation of the three ADR-097 §10 enabling substrate features. Covers `mmnto-ai/totem#1768` (Pack discovery), `mmnto-ai/totem#1769` (ChunkStrategy registry), `mmnto-ai/totem#1653` (ast-grep Lang registry — registry-backed reframe per the 2026-04-30 comment).

PR-B (`@totem/pack-rust-architecture` lift) hard-blocks on this PR landing. PR-C (LC adoption) follows post-PR-B.

## Context

[ADR-097 Pack Language Archetype](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-097-pack-language-archetype.md) accepted 2026-04-30 (`mmnto-ai/totem-strategy#192`). § 6 Stage 1 ships `@totem/pack-rust-architecture` alpha. § 10 lists three enabling tickets that gate Stage 1 — this PR ships all three together because they're tightly thematic (a single architectural commit: Pack registration substrate) and PR-B needs them all to register at boot.

## Files to Examine

1. `packages/core/src/config-schema.ts:10-16` — `ChunkStrategySchema` closed Zod enum (becomes registry-backed).
2. `packages/core/src/chunkers/chunker.ts` — `CHUNKER_MAP` closed `Record<ChunkStrategy, Chunker>` (becomes registry).
3. `packages/core/src/ast-classifier.ts:7,170-185` — `SupportedLanguage` literal union + `extensionToLanguage` switch (both become registry-backed).
4. `packages/core/src/rule-engine.ts:392` — silent-skip site for unmapped extensions per `#1653` (becomes fail-loud).
5. `packages/cli/src/commands/sync.ts:35-129` — `syncCommand` extension point for writing `.totem/installed-packs.json`.
6. `packages/core/src/ingest/pipeline.ts:244` — `createChunker(file.target.strategy)` boot-path consumer.
7. `packages/core/src/pack-merge.ts` — existing pack-merge primitive; co-resident with new pack-discovery substrate.

## Implementation Design

### Scope

Implement the three ADR-097 §10 substrate features in one bundled PR so PR-B (`@totem/pack-rust-architecture` lift) has a stable runtime registration contract. Specifically: (1) `totem sync` writes `.totem/installed-packs.json`; engine boot reads it synchronously and runs pack registration callbacks before sealing; (2) `ChunkStrategySchema` becomes registry-backed; (3) `extensionToLanguage` becomes registry-backed with fail-loud on unmapped extensions per `#1653`.

**Will NOT do:**

- PR-B's pack-side registration callback authoring (`@totem/pack-rust-architecture/src/register.ts`) — separate PR.
- `'rust-ast'` chunker implementation — lives in PR-B's pack package.
- `tree-sitter-rust.wasm` bundling — PR-B's pack package.
- Pack signature verification (`#1492` / `#1250` / `#1545`) — separate ticket cluster.
- Pack lifecycle awareness / deprecation warnings (`#1493`).
- Pack-merge precedence + cache invalidation refinements (`#1249`).
- Multi-pack conflict resolution for shared `lessonHash` (`#1248`).
- Closing `mmnto-ai/totem#1537` (rust-ast strategy hardcoded addition) — closed at PR-B ship.
- `mmnto-ai/totem#1654` (compile-pipeline `Lang.Tsx` hardcode) — implementation-coupled to this PR's registry; can ride PR-A or sibling. Lean: ride PR-A so the registry's first non-TS consumer (compile pipeline) lands with the registry shape proven.
- `mmnto-ai/totem#1655` (CLI compile prompt KIND_ALLOW_LIST) — tier-2, ships separately post-PR-A.

### Data model deltas

**NEW types** (in `packages/core/src/pack-discovery.ts` unless noted):

- `Pack` — runtime descriptor:
  ```ts
  interface Pack {
    readonly name: string;
    readonly resolvedPath: string;
    readonly declaredEngineRange: string;
    readonly register: PackRegisterCallback;
  }
  ```
- `PackRegisterCallback` — `(api: PackRegistrationAPI) => void`. Synchronous per ADR-097 Q5.
- `PackRegistrationAPI`:
  ```ts
  interface PackRegistrationAPI {
    registerChunkStrategy(name: string, chunkerCtor: new () => Chunker): void;
    registerLanguage(extension: string, lang: string, wasmLoader?: () => Buffer): void;
  }
  ```
- `InstalledPacksManifest` — Zod schema for `.totem/installed-packs.json`:
  ```ts
  const InstalledPacksManifestSchema = z.object({
    version: z.literal(1),
    packs: z.array(
      z.object({
        name: z.string(),
        resolvedPath: z.string(),
        declaredEngineRange: z.string(),
      }),
    ),
  });
  ```
  Schema validates strict (`.passthrough()` rejected) so unknown keys are loud.

**MODIFIED types:**

- `SupportedLanguage` (in `packages/core/src/ast-classifier.ts`): currently `'typescript' | 'tsx' | 'javascript'`. Widens to `'typescript' | 'tsx' | 'javascript' | (string & {})` — preserves IntelliSense on built-ins while admitting pack-contributed values (e.g., `'rust'`). See Open Question 1.
- `ChunkStrategySchema` (in `packages/core/src/config-schema.ts`): currently `z.enum([...])`. Becomes `z.string().refine(name => CHUNKER_REGISTRY.has(name), { message: '...' })`. Schema-level validation defers to runtime registry — sealed-before-validation invariant prevents races (see State lifecycle).

**NEW state containers** (all module-level singletons, registry-pattern):

- `CHUNKER_REGISTRY: Map<string, new () => Chunker>` (in new `packages/core/src/chunkers/chunker-registry.ts`). Replaces the closed `CHUNKER_MAP`. Built-in chunkers (`MarkdownChunker`, `TypeScriptChunker`, `SessionLogChunker`, `SchemaFileChunker`, `TestFileChunker`) self-register at module load via top-level `register('markdown-heading', MarkdownChunker)` calls.
- `LANG_REGISTRY: Map<string, { lang: string; wasmLoader?: () => Buffer }>` (in `packages/core/src/ast-classifier.ts`). Replaces the `switch` in `extensionToLanguage`. Built-in entries pre-populated at module load.
- `PACK_REGISTRY: Map<string, Pack>` (in `packages/core/src/pack-discovery.ts`). Populated synchronously by `loadInstalledPacks()` at boot.
- `engineSealed: boolean` (module-level in `packages/core/src/pack-discovery.ts`). Flipped to `true` by `loadInstalledPacks()` after every pack callback returns. All three registries reject mutations after seal.

**Reserved-key / sentinel hazards:** None introduced. The string-keyed registries don't collide with the existing `CompiledRule.fileGlobs` namespace or `lessonHash` space (different concept).

### State lifecycle

| State              | Scope           | Lifetime                                                                       | Ownership             |
| ------------------ | --------------- | ------------------------------------------------------------------------------ | --------------------- |
| `CHUNKER_REGISTRY` | engine-lifetime | pre-populated at module load → mutated during boot via pack callbacks → sealed | `chunker-registry.ts` |
| `LANG_REGISTRY`    | engine-lifetime | pre-populated at module load → mutated during boot via pack callbacks → sealed | `ast-classifier.ts`   |
| `PACK_REGISTRY`    | engine-lifetime | populated by `loadInstalledPacks()` → sealed                                   | `pack-discovery.ts`   |
| `engineSealed`     | engine-lifetime | starts `false` → flips to `true` at end of `loadInstalledPacks()`              | `pack-discovery.ts`   |

**Cross-boundary state crossing (load-bearing):** Pack registration callbacks fire during boot, write to all three registries (CHUNKER + LANG + PACK), then the engine seals. Reads happen post-seal. The seal event is the only boundary; sealed-state mutations throw.

The seal event MUST precede:

1. First call to any function that consumes `CHUNKER_REGISTRY` (e.g., `createChunker()` in `packages/core/src/ingest/pipeline.ts:244`).
2. First call to any function that consumes `LANG_REGISTRY` (e.g., `extensionToLanguage()` in `packages/core/src/rule-engine.ts:392`, `applyRulesToAdditions`).
3. First Zod parse of `targets[].strategy` (in any config-loading site).

The boot sequencing contract: `loadInstalledPacks()` is the canonical boot entry. All three registries' `register()` exports throw if `engineSealed === true`. CLI commands call `loadInstalledPacks()` immediately after `loadConfig()` and before any other engine surface.

### Failure modes

| Failure                                                               | Category                    | Agent-facing surface                                                                                                      | Recovery                                  |
| --------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `installed-packs.json` missing                                        | init                        | silent (treat as empty packs); log debug                                                                                  | `totem sync` regenerates                  |
| `installed-packs.json` malformed JSON                                 | init                        | hard error with file path + JSON parse line                                                                               | fix manifest or `totem sync`              |
| `installed-packs.json` Zod fails (unknown key, wrong shape)           | init                        | hard error naming the field                                                                                               | fix manifest or `totem sync`              |
| Pack file at `resolvedPath` missing                                   | init                        | hard error naming pack + path                                                                                             | reinstall pack                            |
| Pack require throws                                                   | init                        | hard error naming pack + cause                                                                                            | pack-side bug; user reports to maintainer |
| Pack `peerDependencies` engine range doesn't satisfy running version  | init                        | structured error per ADR-097 Q6: "Pack X declares `@mmnto/totem ^1.19.0` but engine is 2.0.0; upgrade pack or pin engine" | upgrade pack or downgrade engine          |
| Pack `register()` callback throws                                     | init                        | hard error naming pack + cause                                                                                            | pack-side bug                             |
| Two packs register same `ChunkStrategy` name                          | init                        | hard error: "ChunkStrategy 'rust-ast' registered by Pack X, attempted re-register by Pack Y"                              | one pack must rename                      |
| Two packs register same extension with different `lang`               | init                        | hard error: "Extension '.rs' registered to 'rust' by Pack X, attempted re-register to 'gleam' by Pack Y"                  | one pack must drop the conflict           |
| `register()` called after seal                                        | runtime                     | hard error: "Engine sealed — pack registration must complete before first engine API call"                                | architectural bug                         |
| `targets[].strategy` references unregistered name                     | runtime (config validation) | hard error per Tenet 4 with name + suggestions from registry                                                              | install pack or fix config                |
| ast-grep dispatch on unmapped extension                               | runtime                     | **BEHAVIOR CHANGE: hard error per `#1653`, was silent skip**                                                              | install pack for that extension           |
| Pack callback registers extension that's already in built-in registry | init                        | hard error: built-in entries are immutable                                                                                | architectural error in the pack           |
| `wasmLoader` throws on first dispatch                                 | runtime                     | hard error wrapping original cause                                                                                        | pack-side WASM bundling bug               |

The "ast-grep dispatch fail-loud" change is a behavior change. The old silent-skip masked rules that legitimately needed an extension Totem didn't support. The fail-loud surfaces them at compile time. **Changeset minor bump.**

Tenet 4 audit: every row above is fail-loud or silent-by-design (the missing-manifest case, which is the new-install / pre-sync case). No row is "silent degradation."

### Invariants to lock in via tests

1. `loadInstalledPacks()` reading a missing manifest returns `{ packs: [] }`, no throw.
2. `loadInstalledPacks()` reading a malformed manifest throws with structured message naming the file + parse failure point.
3. Pack `peerDependencies` mismatch produces structured error naming pack name + declared range + actual engine version (load-bearing per ADR-097 Q6).
4. Re-registration of same pack name throws.
5. After `engineSealed`, every registry's `register()` export throws.
6. All five built-in chunkers (`'markdown-heading'`, `'typescript-ast'`, `'session-log'`, `'schema-file'`, `'test-file'`) register at module load; `lookup('markdown-heading')` returns `MarkdownChunker`.
7. All six built-in language entries register at module load (`.ts` → `'typescript'`, `.tsx` → `'tsx'`, `.jsx` → `'tsx'`, `.js` → `'javascript'`, `.mjs` → `'javascript'`, `.cjs` → `'javascript'`).
8. A pack callback can register a new chunker (`'rust-ast'`) and a new (extension, lang, wasmLoader) tuple (`.rs` → `'rust'`); lookups return the registered values.
9. Two packs registering same `ChunkStrategy` name → fail loud at second registration.
10. Two packs registering same extension to different langs → fail loud at second registration.
11. A pack registering an extension that's already in the built-in set → fail loud (built-in entries immutable).
12. `targets[].strategy: 'rust-ast'` validates successfully when a pack has registered `'rust-ast'`.
13. `targets[].strategy: 'unknown'` fails Zod validation with a message listing the registered set.
14. ast-grep dispatch on `.rs` after `'rust'` registration runs the rule (no silent skip).
15. ast-grep dispatch on `.py` (no pack registered) throws a structured error per `#1653`'s fail-loud framing.
16. Existing test corpus (TS/JS/TSX/JSX) continues to pass — registry shape preserves all current behavior on built-ins.
17. `wasmLoader` is invoked lazily — registration without dispatch never calls the loader; first dispatch on the language calls it once and memoizes.
18. `totem sync` writes a valid `installed-packs.json` against a fixture pack with `extends: ['@totem/pack-fixture']` and the pack present in `node_modules/`.

### Open questions

1. **`SupportedLanguage` type-shape change.**
   - **Question:** Currently `type SupportedLanguage = 'typescript' | 'tsx' | 'javascript'`. With registry-backed entries, packs contribute new values. What's the right type shape?
   - **Options:** (a) widen to `string` everywhere (loses IntelliSense on built-in callers); (b) keep literal union + add `(string & {})` variant — preserves IntelliSense while admitting new values; (c) introduce a `LanguageId` brand.
   - **Recommendation:** (b). Built-in callers continue to type-check against the literal union; pack-contributed lookups return brand-string. Matches pattern used elsewhere for "extensible string union" types.

2. **Where does the engine seal fire?**
   - **Question:** The seal must precede the first ast-grep API call OR the first retrieval pipeline call, whichever comes first. What's the cleanest hook?
   - **Options:** (a) lazy-seal on first call to any consuming API (decentralized, race-prone); (b) explicit `sealEngine()` at end of `loadInstalledPacks()` — single boundary; (c) module-level seal flag flipped by both ast-grep adapter and ingest/pipeline as their first action.
   - **Recommendation:** (b). One boundary, one writer. `loadInstalledPacks()` is the canonical boot-time entry; sealing there keeps the seal strictly synchronous with registration. CLI commands call `loadInstalledPacks()` immediately after config load.

3. **Pack `register()` callback contract — sync only.**
   - **Question:** Some packs may want to load WASM grammar bytes asynchronously during registration. Sync or async?
   - **Options:** (a) sync, defer WASM loading to lookup-time via `wasmLoader: () => Buffer` thunk; (b) async, boot becomes async.
   - **Recommendation:** (a). ADR-097 Q5 mandates synchronous boot. WASM bytes load lazily on first ast-grep dispatch via the registered `wasmLoader` thunk; loader call is memoized.

4. **`totem sync`'s pack-list source.**
   - **Question:** ADR-097 Q5 says "by reading `package.json` dependencies/extends." What's the canonical source?
   - **Options:** (a) walk consumer's `package.json` `dependencies` for `@totem/pack-*`; (b) read `totem.config.ts` `extends` array; (c) both, deduplicated.
   - **Recommendation:** (c). `extends` is the authoritative declaration of "I want this pack's rules." `dependencies` is the npm-level "the package is installed and resolvable." Pack appearing in only one is config drift — log a warning, proceed with the union. Mismatch resolution (precedence rules) deferrable; for v0.1, log + proceed.

5. **`tree-sitter-<lang>.wasm` loader location.**
   - **Question:** Where does the WASM grammar live at runtime? Pack ships it; how does ast-grep find it?
   - **Options:** (a) pack's `register()` hands a `wasmLoader: () => Buffer` thunk; (b) pack manifest declares WASM path, totem-core resolves it; (c) pack registers an explicit `Lang` instance from `@ast-grep/napi` pre-loaded with WASM.
   - **Recommendation:** (a). Cleanest separation — pack owns the loader, totem-core never reads pack files directly, ast-grep adapter calls the loader on first parse and memoizes. Lets the pack handle bundling however it wants (filesystem read, embedded base64, etc.) without core concerning itself.

6. **Bundling vs splitting the three substrate features into PR-A1/A2/A3?**
   - **Question:** PR-A bundles three tickets. Should they split into three smaller PRs?
   - **Options:** (a) bundle (one PR-A); (b) split into PR-A1 (Pack discovery) → PR-A2 (ChunkStrategy registry) → PR-A3 (Lang registry).
   - **Recommendation:** (a) bundle. Per `feedback_bundle_locally_avoid_pr_churn.md`. The three features share state lifecycle (registries, seal event), failure-mode taxonomy (registration conflicts), and test fixtures (pack-fixture for end-to-end). Splitting incurs three review cycles for one architectural commit.

7. **Behavior-change disposition: ast-grep silent-skip → fail-loud.**
   - **Question:** Per `#1653`, today's silent-skip on unmapped extension becomes hard error. This is a breaking change for any consumer that has rules scoped to extensions Totem doesn't support yet.
   - **Options:** (a) ship as fail-loud (per `#1653` framing); (b) ship as warning with one-version deprecation window; (c) gate behind a config flag.
   - **Recommendation:** (a). The silent skip is the bug `#1653` filed against. Consumers with `.rs` rules today (e.g., LC) currently get zero signal that their rules don't fire — making the failure visible IS the fix. Frame in changeset MINOR with a clear migration note: "if you had `.rs`/`.py`/etc. rules and noticed they didn't fire, install the corresponding pack."

8. **`mmnto-ai/totem#1654` ride-along.**
   - **Question:** `#1654` (compile-pipeline `Lang.Tsx` hardcode) is implementation-coupled to PR-A's registry shape. Bundle or sibling PR?
   - **Options:** (a) ride PR-A; (b) sibling PR-A2 immediately after.
   - **Recommendation:** (a). The compile pipeline IS the registry's first non-TS consumer; landing the registry without the consumer leaves a half-finished feature. Bundling `#1654` proves the registry shape end-to-end against a real non-TS path. Per the same `feedback_bundle_locally_avoid_pr_churn.md`.

## Phase 4 Approval Gate

Design doc drafted at `.totem/specs/pack-substrate-bundle.md`. Open questions: 8.

Awaiting user approval before writing implementation code.

Most are recommendation-with-rationale (Q1, Q2, Q3, Q5, Q6, Q7, Q8). Two are config / scope decisions worth explicit user judgement (Q4 — pack list source de-duplication semantics; Q8 — `#1654` ride-along bundling).

Once approved, implementation order:

1. Land registries (chunker-registry.ts + LANG_REGISTRY in ast-classifier.ts) with built-ins, no pack support yet — proves the shape works for current corpus.
2. Land pack-discovery.ts with `loadInstalledPacks()` + seal event.
3. Land `PackRegistrationAPI` surface + `register()` mutation paths on the two registries.
4. Land `totem sync` writer for `installed-packs.json`.
5. Land schema integration: `ChunkStrategySchema` consults registry; `targets[].strategy` validates against registered set.
6. Land ast-grep fail-loud at `rule-engine.ts:392` per `#1653`.
7. Land `#1654` consumer migration (compile-pipeline Lang.Tsx → registry).
8. End-to-end test using a fixture pack in `packages/core/src/__fixtures__/pack-fixture/`.
