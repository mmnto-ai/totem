# @totem/pack-rust-architecture

Baseline architectural lessons for Rust + Bevy ECS consumers. ADR-097 Stage 1 pilot under the `@totem` scope (sister to `@totem/pack-agent-security`).

## Status

ADR-097 Stage 1 alpha pilot. 8 lessons in 4 tiers, sourced from `mmnto-ai/liquid-city` PR #134's review cycle (6 lessons via `totem review-learn` extraction) plus 2 hand-authored seeds for Bucket B1 + B2 territory that didn't surface from automated extraction. Compilation to `compiled-rules.json` runs in the totem CLI workspace; the `lessons/` directory holds source-of-truth markdown for human review and re-compile.

## Coverage

The pack targets Rust + Bevy ECS consumers. Rules split across four tiers:

| Tier                    | Count | Universality                 | Examples                                                                                                                                   |
| ----------------------- | ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Numeric safety          | 3     | Any Rust + linalg/grid code  | Float-to-int overflow → DoS guards; `linvel.norm()` → `f32::INFINITY` finiteness checks; runtime+const-assert pairing for tuning constants |
| Compile-time discipline | 1     | Any Rust                     | Float arithmetic methods (`.floor()`, `.ceil()`, `.sqrt()`, etc.) are non-const; rewrite as direct ops + cast                              |
| Bevy ECS                | 3     | Bevy consumers               | `Local<Vec<T>>` hot-path allocation pattern; schedule edges as producer-consumer contracts; multi-archetype determinism fixtures           |
| Testing discipline      | 1     | Any test-fixture parity work | Test world builders mirror production install order                                                                                        |

Each lesson is self-contained markdown with citation anchors back to the genesis evidence (PR / round-number / file-path), enabling consumers to drill into the underlying CR/GCA review threads where the architectural invariant was originally surfaced.

## Lesson manifest

| Hash              | Tier                    | Title                                                               |
| ----------------- | ----------------------- | ------------------------------------------------------------------- |
| `lesson-2d305b47` | Numeric safety          | `linvel.norm()` overflow despite finite components                  |
| `lesson-d020574f` | Numeric safety          | Float stride loop-bound overflow / DoS                              |
| `lesson-c79543ba` | Numeric safety          | Tuning constants need declaration-site const-asserts                |
| `lesson-de45dee2` | Compile-time discipline | Float arithmetic methods are unavailable in Rust const-eval         |
| `lesson-8cefba95` | Bevy ECS                | Bevy hot-path: `Local<Vec<T>>` instead of per-tick collect          |
| `lesson-b25f0c4a` | Bevy ECS                | Bevy schedule edges encode producer-consumer contracts              |
| `lesson-691fbb72` | Bevy ECS                | Determinism test must use 2+ archetypes for sort to be load-bearing |
| `lesson-9bc7ac4a` | Testing discipline      | Test world builders must install resources/map in production order  |

## Coverage boundaries (honest framing)

This pack is a baseline, not a comprehensive Rust + Bevy lint suite. The 8 lessons capture the highest-signal architectural invariants surfaced by one consumer's review cycles (slice-6 spawn dispersion + vehicle-agent collision in `mmnto-ai/liquid-city`). A Rust consumer with no Bevy footprint will find ~50% direct applicability (the 4 Rust-universal lessons); a Rust + Bevy consumer with determinism requirements will find ~100% applicability.

## Install

Add to `totem.config.ts`:

```typescript
extends: [
  '@totem/pack-rust-architecture',
],
```

Plus `pnpm add -D -w @totem/pack-rust-architecture` per ADR-085 Layer 1 adoption.

## Substrate gap (v0.1)

This pack is the first non-trivial consumer of the ADR-097 § 10 Pack v0.1 substrate, and as such it surfaces a known gap in the substrate that v0.1 papers over with a side-channel:

`PackRegistrationAPI.registerLanguage(extension, lang, wasmLoader)` wires the **web-tree-sitter** side of the engine — `loadGrammar` (`ast-classifier.ts`), `ast-query.ts` (code-element extraction), `ast-gate.ts` (lite-build dispatch), and the lite-build wasm-shim. The runtime hot path for ast-grep rule matching, however, is `@ast-grep/napi`, which has its own `registerDynamicLanguage` API that the substrate does not surface. At `@ast-grep/napi@0.42.0` only `Lang.Html`, `Lang.JavaScript`, `Lang.Tsx`, `Lang.Css`, and `Lang.TypeScript` are built-in; non-built-in languages are unreachable from `parse(name, source)` until `registerDynamicLanguage` is called with the parser binding (e.g., from `@ast-grep/lang-rust`).

**v0.1 workaround (this pack):** `register.cjs` invokes `napi.registerDynamicLanguage({ rust })` directly, alongside the substrate's `api.registerLanguage('.rs', 'rust', wasmLoader)` call. The pack imports `@ast-grep/lang-rust` (parser binding) and `@ast-grep/napi` (the engine's napi instance) directly. The dual registration ensures Rust ast-grep rules dispatch correctly through both paths.

**Visible debt:** This side-channel is documented as time-boxed precedent in [`mmnto-ai/totem#1774`](https://github.com/mmnto-ai/totem/issues/1774), gated on N≥2 pack consumers before the API shape locks. Once a second non-trivial pack lands, `registerNapiLanguage` will be lifted into `PackRegistrationAPI` and this pack will migrate to the API-driven path. Future packs that copy the side-channel pattern should link back to that ticket so the visible-debt tally stays accurate.

## Provenance

- **Initial corpus:** PR `mmnto-ai/liquid-city#134` review cycle (R1-R11 across 12.4h, 11 review rounds, 39 inline comments).
- **Extraction tooling:** `totem review-learn` (Sonnet 4.6 LLM, ~30s per cycle, ~10k tokens).
- **Manual seeding:** Lessons `de45dee2` (B1) and `b25f0c4a` (B2) hand-authored for Rust const-eval limits and Bevy schedule-edge invariants that didn't surface from automated extraction. Cited evidence: PRs `mmnto-ai/liquid-city#132` R1 (B1) and `mmnto-ai/liquid-city#125` R6 + `mmnto-ai/liquid-city#134` task 5 (B2).
- **Curation:** lc-Claude (LC lane) selected the 8-lesson active set per universality × architectural-invariant × enforceability scoring; dev-Gemini (synthesis lane) confirmed the selection.
- **Audit trail:** `audits/internal/2026-04-30-ecosystem-churn-diagnosis.md` (totem-strategy disk) holds the cross-agent diagnostic thread that produced this pack.

## License

MIT. Same as the Totem monorepo.
