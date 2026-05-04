> **Archival note (preserved 2026-05-04, totem-Claude session-0021).**
>
> This is a path-not-taken design doc. Originally drafted 2026-04-24 on local feature branch `feat/1653-1654-rust-support-substrate` as a preflight for #1653 + #1654 (Rust-support substrate). The actual ship arc went a different way: `@mmnto/pack-rust-architecture@1.23.0` shipped 2026-05-01 via the ADR-097 pack-substrate path (see `mmnto-ai/totem-strategy:adr/adr-097-pack-substrate.md`), not the in-engine dispatch refactor proposed here. Both source issues #1653 and #1654 closed via that path.
>
> Preserved because the analytical content has lasting reference value:
>
> 1. **Architectural correction to `mmnto-ai/totem-strategy:upstream-feedback/014`** — explicit critique of the "consolidate `extensionToLanguage` and `extensionToLang`" recommendation, explaining why the two functions back different engines (tree-sitter WASM vs `@ast-grep/napi`) with different capability surfaces and footprint costs.
> 2. **`ResMut<TacticalState>` false-pass exhibit** — concrete pre-1.23.0 reproducer showing the smoke gate validating Rust generic syntax under TSX grammar (parses as JSX element, false-passes).
> 3. **Engine-dispatch separation reasoning** — why `extensionToLanguage` (tree-sitter) and `extensionToLang` (ast-grep) shouldn't share a code path, even though the surface API looks identical.
>
> If a future ticket revisits the in-engine dispatch approach, this doc shows the rejected alternative with full Phase 3 design. The `chore: bump .strategy submodule` and `docs: mark 1.15.4 as published` commits from the source branch are NOT preserved — both are invalid post-#1749 (`.strategy` submodule retired) and post-1.26.x (1.15.4 ancient history).
>
> Original spec lived at `.totem/specs/1653-1654.md` until preserved here.

---

# Spec: α + β Rust-support substrate (#1653 + #1654)

Bundled per upstream-feedback item 017 (three-layer language-support gap). α (engine dispatch) and β (compile-pipeline grammar) are co-requisite: α alone leaves the smoke gate validating non-TS patterns against TSX (false-pass on `ResMut<TacticalState>` exhibit); β alone has no engine to dispatch to. Layer γ (#1655 per-language `KIND_ALLOW_LIST`) is a follow-on after this bundle ships.

## Problem (combined)

Totem's pipeline assumes TS/JS at three independent layers (item 017). This bundle closes the first two:

**α (#1653) — Runtime dispatch.** `rule-engine.ts:363` gates ALL rules (tree-sitter AND ast-grep) on `extensionToLanguage(ext)` returning a tree-sitter `SupportedLanguage`. For any non-TS/JS file, the rule loop short-circuits before either engine runs. Even if `ast-grep-query.ts::extensionToLang` were extended to `.rs`, ast-grep rules would still never reach dispatch because the tree-sitter check fires first. Concrete cost on liquid-city: four `.rs`-scoped ast-grep rules silently inert in `compiled-rules.json`.

**β (#1654) — Compile-pipeline grammar.** `compile-smoke-gate.ts:91-104::inferBadExampleExts` hardcodes `\.(ts|tsx|js|jsx|mjs|cjs)\b` regex; non-TS globs fall back to the TS/JS default set, and the smoke gate runs non-TS patterns against TSX. `compile-lesson.ts:262::parse(Lang.Tsx, '')` validates every pattern under TypeScript grammar. The liquid-city `ResMut<TacticalState>` exhibit demonstrates the false-pass: TSX parses Rust generic syntax as a JSX element, smoke gate reports match, the rule ships with vacuous validation.

## Code locations (verified against current main)

| File                           | Site                                           | Today                             | After                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ast-classifier.ts:170`        | `extensionToLanguage(ext) → SupportedLanguage` | TS/JS only                        | **Unchanged** (drives tree-sitter WASM; different concern, separate footprint decision)                                                                 |
| `ast-grep-query.ts:24`         | `extensionToLang(ext) → Lang`                  | TS/JS only                        | **Deleted**, imported from new shared module                                                                                                            |
| `rule-engine.ts:363`           | `if (!extensionToLanguage(ext)) continue;`     | gates both engines on tree-sitter | **Split** — tree-sitter check moves into tree-sitter branch; ast-grep branch flows through to its own dispatch + emits `onWarn` for unmapped extensions |
| `ast-gate.ts:49`               | `extensionToLanguage(ext)`                     | TS/JS only                        | **Unchanged** (tree-sitter classification scope)                                                                                                        |
| `ast-query.ts:128, 183`        | `extensionToLanguage(ext)`                     | TS/JS only                        | **Unchanged** (tree-sitter S-expression query scope)                                                                                                    |
| `compile-smoke-gate.ts:91-104` | `inferBadExampleExts` regex literal            | TS/JS extensions only             | **Driven from shared map** — supports all extensions in `EXT_TO_AST_GREP_LANG`                                                                          |
| `compile-lesson.ts:262`        | `parse(Lang.Tsx, '')`                          | TSX always                        | **Iterates** target `Lang[]` from rule's `fileGlobs`; passes if any parses                                                                              |

## Architectural correction to the upstream-feedback proposal

Item 014 proposes "consolidate `extensionToLanguage` and `extensionToLang` into one shared module." This is structurally wrong. `extensionToLanguage` returns the tree-sitter `SupportedLanguage` union (`'typescript' | 'tsx' | 'javascript'`) and drives WASM grammar loading via `loadGrammar`; extending it to Rust/Python requires shipping `tree-sitter-rust.wasm` etc. with binary-footprint implications. `extensionToLang` returns `@ast-grep/napi`'s `Lang` enum and drives the napi-bundled parsers, which already include Rust/Python/Go at zero footprint cost. The two functions back different engines with different capability surfaces. **Consolidate only the ast-grep dispatch.** Tree-sitter expansion is a separate, scope-narrower decision deferred until contextcoping for non-TS becomes load-bearing (today the `astContext: undefined` fallback at `ast-gate.ts:50` is fail-open and degrades gracefully — non-TS files lose context classification but ast-grep still runs).

## Acceptance (combined)

From #1653:

- [ ] `extensionToAstGrepLang` sources its mapping from `@ast-grep/napi`'s `Lang` enum, exported from `packages/core/src/ast-grep-languages.ts`.
- [ ] `ast-grep-query.ts::extensionToLang` deleted; both call sites in that file import from the new module.
- [ ] Ast-grep rules scoped to `.rs` fire at runtime against Rust files (verified via fixture-based integration test).
- [ ] `onWarn` callback fires with `{ rule, file, extension }` when an ast-grep rule hits an unmapped extension.
- [ ] Regression test: rule with `fileGlobs: ["**/*.rs"]` and Rust-valid pattern matches against `.rs` badExample fixture.

From #1654:

- [ ] `inferBadExampleExts` returns the correct language-appropriate extension set for non-TS `fileGlobs` (e.g., `['.rs']` for `**/*.rs`).
- [ ] `compile-lesson.ts:262` parser validator uses the rule's target language(s), not hardcoded `Lang.Tsx`.
- [ ] Regression test: a `.rs`-scoped rule with a syntactically-valid Rust pattern passes the smoke gate AND fires at runtime.
- [ ] Regression test: a `.rs`-scoped rule with a syntactically-invalid Rust pattern fails the smoke gate with a Rust-parser error (not a TSX-parser error).
- [ ] Regression test: `ResMut<TacticalState>` no longer false-passes the smoke gate via TSX misinterpretation.

---

## Implementation Design

### Scope

**Will:** add `packages/core/src/ast-grep-languages.ts` as the single source of truth for ext → `@ast-grep/napi` `Lang`; extend coverage to `.rs, .py, .go, .java, .rb, .cs, .swift, .kt, .c, .h, .cpp, .cxx, .cc, .hpp` (plus existing TS/JS); split the `rule-engine.ts:363` gate so ast-grep rules are not blocked by the tree-sitter map; thread target `Lang[]` from `fileGlobs` through both compile-pipeline call sites; emit a structured `AstGrepWarning` when ast-grep encounters an unmapped extension.

**Will NOT:** extend tree-sitter `SupportedLanguage` (`ast-classifier.ts`) to non-TS/JS — separate footprint decision, deferred. Will NOT add per-language `KIND_ALLOW_LIST` (γ / #1655 follow-on). Will NOT add a compile-time gate that rejects ast-grep rules scoped to unmapped extensions (Option C in item 014, deferred to tier-3). Will NOT add a `totem doctor` advisory surface for unmapped-extension warnings — the `onWarn` channel is sufficient for the v1; doctor wiring deferrable.

### Data model deltas

**New module: `packages/core/src/ast-grep-languages.ts`**

| Symbol                                  | Shape                                                                          | Writer                | Readers                                                                                                                           | Invariants                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXT_TO_AST_GREP_LANG`                  | `Readonly<Record<string, Lang>>` keyed by lowercase extension with leading dot | Module init (literal) | `extensionToAstGrepLang`, `inferBadExampleExts`, `getLanguagesForGlobs`                                                           | Keys lowercase, leading-dot. Values from `@ast-grep/napi`'s `Lang` enum (no string literals). Frozen.                                                                        |
| `extensionToAstGrepLang(ext: string)`   | `(string) → Lang \| undefined`                                                 | —                     | `ast-grep-query.ts` (both `match*` fns), `rule-engine.ts` ast-grep branch, `compile-smoke-gate.ts`, `compile-lesson.ts` validator | Lowercases input. `undefined` for unmapped extensions. Pure function.                                                                                                        |
| `getLanguagesForGlobs(globs: string[])` | `(string[]) → Lang[]`                                                          | —                     | `compile-lesson.ts:262` validator, `compile-smoke-gate.ts::inferBadExampleExts` indirectly                                        | Returns unique `Lang` values. Empty input or no glob match → fallback to all `Object.values(EXT_TO_AST_GREP_LANG)` deduped. Sourced from same map (no parallel maintenance). |
| `AstGrepWarning`                        | `{ rule: string; file: string; extension: string }`                            | —                     | `applyAstRulesToAdditions` emitter, eventual `totem lint` consumer                                                                | All fields required and non-empty. `rule` is the lessonHash; `extension` retains leading dot or empty string for extensionless files.                                        |

**No reserved keys, no sentinels.** Empty extension (`extname('Makefile') === ''`) maps to `undefined` and emits a warning with `extension: ''`. Frozen map prevents accidental mutation.

**Existing `ast-classifier.ts::extensionToLanguage` and `SupportedLanguage` type unchanged.** Tree-sitter capability surface is untouched.

### State lifecycle

| State                      | Scope                 | Lifetime                                                                    | Ownership                      |
| -------------------------- | --------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| `EXT_TO_AST_GREP_LANG`     | module-level constant | server-lifetime; frozen at module load                                      | `ast-grep-languages.ts` module |
| `AstGrepWarning` instances | per-call (transient)  | created in rule-engine loop, immediately handed to `onWarn`, no persistence | `applyAstRulesToAdditions`     |

No state crosses lifecycle boundaries. No new singletons. The warning channel re-uses the existing `onWarn?: (msg: string) => void` signature on `applyAstRulesToAdditions` — see open question #4 on whether to widen the signature for structured payloads or stringify.

### Failure modes

| Failure                                                                                               | Category     | Agent-facing surface                                                                                            | Recovery                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Ast-grep rule on unmapped extension (`.zig`, `.lua`)                                                  | runtime      | `onWarn({ rule, file, extension })` — visible in `totem lint` output                                            | None needed; warning is the surface. Rule is a no-op for that file; runtime continues. |
| Tree-sitter rule on unmapped extension                                                                | runtime      | silent skip (current behavior, unchanged — see scope)                                                           | Existing fail-open; tree-sitter rules never claimed multi-language scope.              |
| `compile-lesson.ts` pattern fails to parse under all target languages                                 | compile-time | `valid: false` + last parser's error in `reason` field                                                          | Rule rejected at compile time; LLM retries via existing pipeline.                      |
| `compile-smoke-gate.ts` extension has no language mapping (mixed-language glob `**/*.{rs,zig}`)       | compile-time | smoke-gate continues with mapped extensions only; `.zig` skipped silently within the gate (parity with runtime) | Existing per-extension iteration tolerates partial coverage.                           |
| `inferBadExampleExts` returns empty set for unscoped rule                                             | compile-time | falls back to all extensions in `EXT_TO_AST_GREP_LANG`                                                          | Same fallback semantics as today, just over a broader set.                             |
| `rule-engine.ts:363` ast-grep rule iterates a file with unmapped extension AND no tree-sitter mapping | runtime      | `onWarn` fires once per (rule, file) pair; no double-warn                                                       | Loop continues to next rule.                                                           |

The "silent skip" surface in row 2 is the only new fail-silent path remaining and it is a Tenet 4 carve-out: tree-sitter is not the engine that ships rules to non-TS users (ast-grep is), so silent context-fallback is correct degradation rather than hidden failure. If a future ticket extends `KIND_ALLOW_LIST` per language (γ), this surface should be revisited.

### Invariants to lock in via tests

- **Map is single source of truth.** No code path resolves `.rs → Lang.Rust` (or any other extension) outside `EXT_TO_AST_GREP_LANG`. Test asserts no string-literal `Lang.Rust` reference exists in `ast-grep-query.ts`, `compile-smoke-gate.ts`, `compile-lesson.ts`, or `rule-engine.ts` — only imports from `ast-grep-languages.ts`.
- **Engine dispatch separation.** A rule with `engine: 'ast-grep'` and `fileGlobs: ['**/*.rs']` reaches the ast-grep dispatch even when the file's extension has no tree-sitter mapping. Failure case before this change; must pass after.
- **Smoke gate language-correctness.** A pattern matching Rust generic syntax (`ResMut<$T>`) does NOT match a TypeScript file containing the same character sequence at compile time when the rule's `fileGlobs` are `['**/*.rs']`. Direct regression of the liquid-city false-pass exhibit.
- **Compile-pipeline parser scoping.** `compile-lesson.ts:262`-equivalent validator rejects a syntactically-invalid Rust pattern with a Rust-parser error (not a TSX-parser error) when the rule is scoped to `.rs`. Locks in β's correctness improvement.
- **Warning shape.** `AstGrepWarning` payload fields are populated and non-empty for every invocation; tests assert `rule`, `file`, `extension` all present. Empty `extension` allowed only for extensionless files.
- **Tree-sitter capability untouched.** `extensionToLanguage('.rs')` still returns `undefined` after this change. No coverage regression for the tree-sitter consumers.

### Open questions

**Q1: Bundle vs. split PR.**

- Options: (a) one PR for both 1653+1654; (b) sequential PRs landing α first, then β as follow-up.
- Tradeoff: (a) ships the architecturally complete substrate atomically — no in-between state where rules dispatch but the smoke gate lies. (b) smaller diffs per PR, easier review, but leaves a multi-day window where the smoke gate is the documented weak link in main.
- Recommendation: **(a) bundle.** The signoff already framed this as the bundle, item 017 codified the co-requisite property, and the touched files largely don't overlap (α ≈ rule-engine + ast-grep-query; β ≈ compile-smoke-gate + compile-lesson) so the diff stays readable.

**Q2: `onWarn` signature widening.**

- Today `applyAstRulesToAdditions(..., onWarn?: (msg: string) => void)`. The new `AstGrepWarning` payload is structured.
- Options: (a) stringify in the rule engine (`onWarn(\`ast-grep: rule ${hash} skipped ${file} (extension ${ext} unmapped)\`)`), keep signature; (b) widen to a discriminated union — `onWarn?: (msg: string \| AstGrepWarning) => void`; (c) add a separate callback — `onAstGrepUnmapped?: (w: AstGrepWarning) => void`.
- Tradeoff: (a) lowest surface-area change, cheapest review. (b) structured payload available downstream (e.g., for telemetry) but breaks one parameter type and requires every call site to handle both shapes. (c) cleanest separation, two callbacks to thread.
- Recommendation: **(a) stringify** for this PR. A structured callback can land later if telemetry consumes it (analogous to the `onSeverityOverride` callback added in #1658).

**Q3: Warning surface in `totem lint` output.**

- Item 014 acceptance: "Warning surfaced in `totem lint` output when an ast-grep rule's extension has no mapping (not silent)."
- Today `applyAstRulesToAdditions` accepts `onWarn`; the CLI's `totem lint` wires it to a warning sink. Does the existing sink pass through? Need to verify the CLI surface, but assuming the standard `onWarn` already prints to lint output, no extra wiring needed.
- Recommendation: **verify during implementation**, file follow-up if the sink swallows warnings.

**Q4: Extensionless files.**

- A rule with `fileGlobs: ['**/*']` running against `Makefile` (no extension) — emit warning with `extension: ''` or skip silently?
- Recommendation: **emit warning**. Silently skipping is the current bug. If the user authored an ast-grep rule scoped to extensionless files, they should see the no-mapping signal.

**Q5: Submodule-pointer bump.**

- Strategy main advanced two commits (`ecda627` + `769ffb6`) past the totem submodule pointer this morning. The bump rides on this feature branch.
- Recommendation: **commit the pointer bump as the first commit on the feature branch**, separate from the α+β code commits. Surfaces cleanly in the PR diff for the submodule reviewer.
