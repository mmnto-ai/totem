# Changelog

## 1.26.0

### Minor Changes

- c00dc7b: **ADR-097 § Q6 amended — engine-version constraint moves from `peerDependencies` to `engines` (closes #1803).**

  Pack manifest resolver (`pack-manifest-writer.ts:readEngineRange`, formerly `readPeerEngineRange`) now reads `engines['@mmnto/totem']` from the resolved pack's `package.json` instead of `peerDependencies['@mmnto/totem']`. The boot-time engine-version cross-check (`pack-discovery.ts:assertEngineRangeSatisfied`) reads the same value via `installed-packs.json#packs[].declaredEngineRange` and continues to fail loud on semver mismatch.

  **Why the move:**
  - `engines` is npm-canonical for engine-version constraints. `peerDependencies` is for actual peer packages the consumer must install (e.g., `@ast-grep/napi`). Mechanism mapping is now correct.
  - Symmetry across the cohort. Internal and future external packs declare `engines.@mmnto/totem` consistently; `peerDependencies` is uniformly for actual peer packages only.
  - Closes the structural collision with `mmnto-ai/totem#1777` (the `1.22.0 → 2.0.0` wiggle root cause): a fixed-group sibling pack cannot peer-dep `@mmnto/totem` without triggering a changesets MAJOR cascade. The `engines` field is not touched by changesets fixed-group auto-bump, so the wiggle stays prevented even with a declared engine constraint.

  **Migration shape:**
  - `@mmnto/pack-rust-architecture` and `@mmnto/pack-agent-security` now declare `"engines": { "@mmnto/totem": "^1.25.0" }`. Neither declares `@mmnto/totem` in `peerDependencies` (locked by `structure.test.ts` invariants in both packs).
  - The `not-a-pack` warning in `totem sync` was reworded to point at the actual gap: `"missing engines['@mmnto/totem'] declaration — pack cannot satisfy the engine-version cross-check (ADR-097 § 5 Q6). Add '"engines": { "@mmnto/totem": "^<version>" }' to the pack's package.json and republish."` Pre-#1803 text was misleading per `mmnto-ai/totem#1803`'s reproducer (it claimed the registration callback was missing when the callback was correctly exported).
  - No fallback to the legacy `peerDependencies['@mmnto/totem']` slot. Pre-1.26.0 packs that declared the engine constraint via peerDeps (none known to exist outside the `@mmnto/*` cohort, all of which are migrated in this cohort) must republish with `engines` declared.

  Closes #1803.

### Patch Changes

- 9f0535d: **Fix `engines['@mmnto/totem']` constraint floor — `^1.25.0` → `^1.26.0`.**

  GCA HIGH catch on the auto-generated Version Packages PR (#1808). The engines-field reader (`pack-manifest-writer.ts:readEngineRange`) ships in `@mmnto/totem@1.26.0`. Engines pre-1.26.0 read `peerDependencies['@mmnto/totem']` and would silently treat these packs as `not-a-pack` (the engines field is invisible to them). Declaring compatibility with `^1.25.0` was technically incorrect — a 1.25.0 engine cannot satisfy these packs even though caret-semver would let it match.

  Tightening the floor to `^1.26.0` makes the constraint match actual runtime compatibility. Fixed-group co-versioning makes this a documentation / safety-rail correction in practice (consumers pinned to a 1.26.x pack pull in the matching 1.26.x engine via the cohort), but the declared range should reflect reality.

  No code change. Constraint-only tightening.

## 1.25.0

## 1.24.0

### Minor Changes

- 67c3ad3: **ADR-091 § Bootstrap Semantics: pack pending-verification install→lint promotion (#1684)**

  Closes the cloud-compile bootstrap gap that ADR-091 § Bootstrap Semantics defined: pack rules cannot be trusted to fire on the consumer's codebase until Stage 4 verifies them locally, so they now enter the consumer's manifest as `'pending-verification'` and the next `totem lint` runs the verifier and promotes them per outcome.

  **`CompiledRule.status` enum extended** with a fourth lifecycle value `'pending-verification'` alongside `'active' | 'archived' | 'untested-against-codebase'`. The lint-execution path (`loadCompiledRules`) treats it as inert exactly like `'archived'` and `'untested-against-codebase'`; the admin path (`loadCompiledRulesFile`) returns it unfiltered so the promotion interceptor can find pending entries.

  **`totem install pack/<name>`** now stamps every pack rule `'pending-verification'` regardless of the status the pack shipped with. The pack's authoring environment cannot have run Stage 4 against the consumer's codebase, so the cloud-compile status is meaningless on the consumer side. The install command appends `Run \`totem lint\` to activate pack rules` to its output as the activation hint.

  **`.totem/verification-outcomes.json`** is the new committable side-table that memoizes Stage 4 outcomes across runs. The first lint run after install reads pending rules from the manifest, invokes the Stage 4 verifier on each, maps the outcome to one of the four terminal lifecycle values per Invariant #3, atomically writes the outcomes file with canonical-key-order serialization (Invariant #11 — byte-stable across runs so consumer repos see no phantom diffs), and saves the mutated manifest. Subsequent lint runs read the recorded outcome from the file and skip re-verification (Invariant #4); a pack content update produces a new `lessonHash` which has no recorded outcome, so the verifier runs again (Invariant #5).

  **Per-rule verifier-throw isolation** (Invariant #7): one failing rule's verifier-throw does not abort the lint pass; that rule remains `'pending-verification'` and the next lint retries.

  **Empty-pending fast path** (Invariant #9): the common-case lint pass with zero pending rules pays no verification cost and skips the outcomes-file read entirely.

  **New public API** in `@mmnto/totem`:
  - `promotePendingRules(rules, deps)` and `applyOutcomeToRule(rule, entry)` — the core interceptor.
  - `readVerificationOutcomes(filePath, onWarn?)` and `writeVerificationOutcomes(filePath, outcomes)` — the persistence layer.
  - `VerificationOutcomeEntrySchema`, `VerificationOutcomesFileSchema`, `Stage4OutcomeStored` — Zod schemas.
  - `VerificationOutcomesStore`, `VerificationOutcomesFile`, `VerificationOutcomeEntry`, `Stage4OutcomeStoredValue`, `PromotePendingRulesDeps`, `PromotePendingRulesResult` — types.

  **Naming-collision context (option B):** the original ADR-091 draft specified `.totem/rule-metrics.json` for the verification-outcomes file, but `packages/core/src/rule-metrics.ts` already exists as a per-machine telemetry-cache module (`triggerCount`, `suppressCount`, `evaluationCount`) with a gitignored `.totem/cache/rule-metrics.json` lifetime. ADR-091 § 65 was amended to specify `.totem/verification-outcomes.json` instead — separate filename for the new committable verification state, separate module name (`verification-outcomes.ts`) for the new schemas + persistence layer.

## 1.23.0

### Minor Changes

- 94ea4a8: **Pack v0.1 alpha pilot: `@mmnto/pack-rust-architecture` lift + ADR-091/097 substrate completion (#1773)**

  First non-trivial consumer of the ADR-097 § 10 Pack v0.1 substrate (#1768/#1769/#1770 in 1.22.0). Validates the substrate end-to-end by registering Rust as a language extension and dispatching ast-grep rules against `.rs` source.

  **`@mmnto/pack-rust-architecture@1.23.0`** — new package (`private: true`)
  - 8 baseline lessons sourced from `mmnto-ai/liquid-city#134` (slice-6 vehicle-agent + dispersion review cycle, lc-Claude attribution preserved)
  - Synchronous CJS `register.cjs` wires Rust into both engine paths: `api.registerLanguage('.rs', 'rust', wasmLoader)` for the web-tree-sitter side and `napi.registerDynamicLanguage({ rust })` for the @ast-grep/napi side (v0.1 side-channel, see `@mmnto/totem#1774`)
  - Bundled `tree-sitter-rust.wasm` (1.1 MB) sourced from `@vscode/tree-sitter-wasm@0.3.1` (MIT, Microsoft) via `prepare`-time copy
  - `compiled-rules.json` ships one tracer-bullet seed rule (`lesson-8cefba95`, Bevy hot-path `Local<Vec<T>>` per-tick allocation) — full LLM-compile of the 8-lesson set deferred to a focused follow-up since γ (per-language `KIND_ALLOW_LIST`, #1655) is needed before LLM-compile of Rust patterns avoids TS-grammar hallucinations
  - Runtime integration tests boot the pack via `loadInstalledPacks({ inMemoryPacks })` and verify the seed rule fires on `.rs` source through the full substrate path

  **`@mmnto/totem` — #1654 fix: thread target Lang through the compile-time pattern validator**

  Pre-#1654, `validateAstGrepPattern` always parsed under `Lang.Tsx` regardless of the rule's `fileGlobs`, and `inferBadExampleExts` (smoke gate) used a TS/JS-only regex that silently fell back to the default set for non-TS rules. A Rust pattern would either false-pass under TSX (the `ResMut<TacticalState>` exhibit) or false-fail with a TSX-parser error.
  - `validateAstGrepPattern(pattern, fileGlobs?)` now resolves the target Lang via `resolveAstGrepLangs(fileGlobs)` and accepts the pattern when any one Lang accepts it. Falls back to `Lang.Tsx` when fileGlobs is empty or no glob carries a registered extension (preserves legacy unscoped-rule semantics).
  - `inferBadExampleExts` extracts any trailing extension from `fileGlobs` (not just TS/JS); runtime's `extensionToLang` filters out unmapped extensions inside `matchAstGrepPattern` so unmapped extensions cleanly return zero matches without parsing under the wrong grammar.
  - New `resolveAstGrepLangs` helper exported alongside `extensionToLang` from `ast-grep-query.ts`.
  - 6 new regression tests covering the LC false-positive exhibit and the TS-fallback preservation invariant.

  **Substrate-extension follow-up filed as #1774 (tier-2, investigation)**: lift the napi-side language registration into `PackRegistrationAPI.registerNapiLanguage` once N≥2 pack consumers exist. PR-B's side-channel pattern in `register.cjs` is the time-boxed precedent that gathers design data; the side-channel is documented as visible debt in the pack's README.

### Patch Changes

- d4e2eb1: **Fix #1776 wiggle — remove `@mmnto/totem` peerDep from `@mmnto/pack-rust-architecture`.**

  The first Version Packages auto-cut after PR #1775 pre-empted `1.22.0 → 2.0.0` instead of `1.22.0 → 1.23.0` despite all changesets being declared `minor`. Root cause: `@mmnto/pack-rust-architecture` declared `peerDependencies['@mmnto/totem']: ^1.22.0`, which combined with the changesets `fixed` group creates a circular constraint — the pack's peerDep range update on a totem minor bump triggers a MAJOR cascade per the changesets peerDep-update policy, and the cascade lifts every fixed-group member to a major bump.

  Fix mirrors the pattern in `@mmnto/pack-agent-security`: fixed-group packs do not declare `@mmnto/totem` as a peerDep — version harmony is guaranteed at publish time by the fixed group itself, not by peerDep range pinning. `@ast-grep/napi` (external, not in the fixed group) remains a peerDep as expected.

  Test `structure.test.ts` updated to assert the exact-key equality of `peerDependencies` so a regression in this rule is caught at unit-test time, not at next Version Packages auto-cut.

  No runtime behavior change. Pack still registers Rust into both engine paths via `register.cjs`.

All notable changes to `@mmnto/pack-rust-architecture` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-30

### Added

Initial release. 8 baseline architectural lessons for Rust + Bevy ECS consumers, sourced from `mmnto-ai/liquid-city` PR #134's slice-6 review cycle (vehicle-agent contact + dispersion implementation) plus 2 hand-authored seeds.

**Numeric safety (3 lessons):**

- `lesson-2d305b47` — `linvel.norm()` overflow to `f32::INFINITY` despite finite vector components; `is_finite()` guard + regression test pattern.
- `lesson-d020574f` — Float stride loop-bound DoS: validate finiteness, then cast to integer, then `saturating_mul` against `MAX_TOTAL_CELLS`.
- `lesson-c79543ba` — Tuning constants with runtime `assert!` guards need matching `const _: () = assert!(...)` at the declaration site for compile-time enforcement.

**Compile-time discipline (1 lesson):**

- `lesson-de45dee2` — Float arithmetic methods (`.floor()`, `.ceil()`, `.sqrt()`, `.powf()`, `.powi()`, `.abs()`, trig/log family) are unavailable in Rust const-eval (1.95). Const-assert rewrites use direct ops + cast (divide-then-cast, not pre-cast).

**Bevy ECS (3 lessons):**

- `lesson-8cefba95` — Bevy hot-path: `Local<Vec<T>>` system parameter with `.clear()` + `.extend()` instead of per-tick `query.iter().collect()`.
- `lesson-b25f0c4a` — Bevy schedule `.before/.after` edges must encode explicit producer-consumer or wake-gate contracts; companion rule on Bevy 0.14's `.chain()` ~20-system tuple-trait limit.
- `lesson-691fbb72` — Determinism tests must use 2+ archetypes for sort-by-`Entity` ID to be load-bearing; single-archetype fixtures pass vacuously.

**Testing discipline (1 lesson):**

- `lesson-9bc7ac4a` — Test world builders must install resources / map data in the same order as production; extract a shared base builder so production and test paths share the sequenced setup.

### Sources

- 6 lessons via `totem review-learn` extraction on `mmnto-ai/liquid-city#134` (Sonnet 4.6, 8.7k in / 1.3k out tokens).
- 2 lessons hand-authored to seed Bucket B1 + B2 territory per `audits/internal/2026-04-30-ecosystem-churn-diagnosis.md` § 4 dev-Gemini's three-bucket diagnosis.

### Notes

- `private: true` for the initial release, consistent with `@mmnto/pack-agent-security` precedent.
- `compiled-rules.json` not included in this draft; regenerated by the totem CLI in the package workspace once the lessons are at `packages/pack-rust-architecture/lessons/`.
- ADR-097 Stage 1 pilot. Stage 2 cycles will harvest from additional consumers (totem itself, future Rust + Bevy adopters) for v0.2.
