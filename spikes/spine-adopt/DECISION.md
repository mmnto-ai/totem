# Spine spike pair — decision report (DRAFT; two rows pending)

**Charter:** operator word 2026-08-27; design source of record = strategy-codex's adopt-round
deposit (Q1 ranks 1–2 + Q-GAP) + the round's three enrichment rows. Durable record:
mmnto-ai/totem-strategy#1138. Everything below is measured, not estimated; artifact paths are
repo-relative to `spikes/spine-adopt/` on branch `wt/spine-spike`. A pass adopts nothing by
itself — this report IS the adoption decision input.

## Verdicts against the ruled criteria

### Spike 1 — OPA Rego→Wasm: **PASS**

| Criterion (verbatim)                                    | Result                                                                                                                                                                                         | Artifact                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| identical verdicts on every registered good/bad fixture | 72/72 MATCH, violations AND event streams, 3 arms (shipped/OPA-wasmtime/regorus)                                                                                                               | `artifacts/differential-report.json`                     |
| repeatable artifact hash                                | byte-identical wasm + bundle, 2 consecutive builds ×7 records; stable across full regenerate                                                                                                   | `artifacts/chains/*.json`                                |
| all imports/builtins enumerated                         | imports = env.memory + opa_abort + opa_builtin0..4; **zero host builtins** — regex.match compiles natively into the wasm (falsified controls prove the census sees host builtins when present) | `artifacts/opa-abi-census.json`                          |
| no network                                              | none (verified: no wasi, no sockets; evaluation pure)                                                                                                                                          | same                                                     |
| bounded cold/warm runtime                               | compile ~24ms median; cold eval ~61µs; warm ~50µs (wasmtime). wazero: warm ~100µs means                                                                                                        | `artifacts/opa-verdicts.json`, `wazero-probe/artifacts/` |

**Scope bound (the honest edge):** 49/226 corpus regex patterns are inexpressible on this path —
48 lookaround-bearing + 1 backreference — ALL rejected at compile, never silently
(`artifacts/lowering-rejects.json`, `artifacts/expressibility-census.json`). The record-grammar
path already refuses the lookbehind one (safe-regex2), so the _record-era_ gap is lookaheads.

**Hazards a production adoption must carry:**

1. `opa build -t wasm` has **no strict mode** — an uncompilable builtin call builds (exit 0) and
   fails OPEN at eval (empty result, no trap). Cure shipped in the lowering: a `patterns_compile`
   probe inside the complete `result` rule + host raising undefined-result as an error.
2. regorus's regex capability is a property of the CONSUMER's dependency graph (it declares
   `regex` with default-features off; without host-side `unicode-perl`, 10/24 rows error). As a
   reference oracle it must be pinned WITH its feature graph.
3. MSVC: regorus 0.11.0 stock does not build (Spectre-libs build script panic); needs
   `default-features = false`.

### Spike 2 — solver-neutral Z3/cvc5: **PASS** (capability ruling recorded)

| Criterion                                 | Result                                                                                                                                                                                                                                                              | Artifact                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Z3 and cvc5 agree on SAT/UNSAT            | 9/10 decided by both, **zero semantic contradictions**; O9/O10 = explained capability bounds (cvc5 timeout), ruled not-disagreement (`smt/OBLIGATIONS.md` § Ruling)                                                                                                 | `smt/artifacts/obligations-report.json` |
| countermodels stable                      | 14/14 rows byte-stable across two runs per solver                                                                                                                                                                                                                   | same                                    |
| unsat-core/proof material binds the chain | 20 chain rows: obligation→SMT-LIB→evidence sha256; emission byte-deterministic                                                                                                                                                                                      | `smt/artifacts/chains.json`             |
| timeouts fail closed                      | O10 verified: timeout/unknown ⇒ NOT-PROVEN, no pass-through; outer kill backstop                                                                                                                                                                                    | report + `smt/src/runner.rs`            |
| static/vendored builds Windows+Linux      | Windows: **z3 binding BUILDS on MSVC** (10/10 obligations via API, all agree with CLI); **cvc5 binding does NOT build** (bindgen libclang + no MSVC import lib in the pinned distribution) → challenger runs at the SMT-LIB process boundary. Linux: CI row pending | `smt/` crate, CI                        |

**The adoption-shaping findings:**

1. **D6 encoding sensitivity:** one logically redundant assertion moved cvc5 from 34ms SAT to
   undecided at 300s (z3 indifferent). A lowerer emitting redundant guards makes the challenger
   unusable; encoding discipline is a first-class constraint.
2. cvc5 = **budgeted corroboration, never a gate** (smaller decidable set, process-boundary only on
   Windows).
3. The naive `\b`→`[^\w]` desugar is **provably not language-preserving** (line-edge witness); the
   careful desugar is verified equivalent (O9).
4. Dialect divergences D1–D5 probed live (control-byte literals, --incremental, timeout spelling,
   core printing, re.loop acceptance) — a portable emitter must target the common subset.

### Enrichment — wazero (Go-satellite constraint): **CLOSED, viable**

24/24 verdict parity with the wasmtime arm on the exact unmodified artifacts (SHA-verified); both
ABI paths (classic + one-shot `opa_eval`) cross-checked, zero disagreements; memory growth
exercised. **Component model NOT needed** — every import/export is core wasm; the wasm contract can
freeze on core wasm. Day-one friction: wazero's HostModuleBuilder cannot export a memory —
OPA's `env.memory` import needs a ~120-line synthesized shim module (constant, not per-policy).
`wazero-probe/artifacts/wazero-report.json`.

### Enrichment — egg/egglog on DSL→IR normalization: **PENDING** (probe running; pre-registered check in `egg-probe/DESIGN.md`)

### Enrichment — wasm validation/mutation (wasm-tools 1.258.0): **DONE**

Original artifact validates and matches its committed chain sha exactly. A single-byte corruption
fails validation loudly (`invalid value type at offset 0x64`). A validity-preserving
`wasm-tools mutate --seed 1` mutant PASSES validation but diverges from the chain sha — measured
proof that **the R2 hash chain is the load-bearing defense against artifact substitution;
validation only catches corruption.** `artifacts/wasm-validation-mutation.json`.

### Build matrix: Windows measured throughout; **Linux CI row PENDING** (workflow authored, first run on push)

## Explicit rejects (the deliverable the criteria demand)

1. Lookaround/backreference regex patterns (49/226) — inexpressible in the OPA path; enumerated,
   compile-loud. Disposition: they remain legacy-path or get re-authored (the requires-vs-lookahead
   control `09ee37252a814a09` shows the record grammar's `requires:` expresses the dominant
   lookahead idiom natively).
2. cvc5 Rust binding on Windows — rejected for V1 (two independent blockers); process boundary
   instead.
3. Naive `\b` desugar — rejected with witness; careful desugar or native `\b` only.
4. regorus as silent semantics replacement — confirmed reference-only (consumer-graph hazard).
5. Component-model wait for the Go lane — rejected as unnecessary (core wasm suffices).
6. `--strict-builtin-errors` as the wasm strictness story — impossible (eval-only flag);
   structural strictness instead.

## Recommendation (drafted; final after pending rows)

**Adopt the OPA Rego→Wasm compilation-target lane for the Spine's compile+runtime layer** within
the enumerated expressibility bound, with the structural-strictness pattern as a required part of
the lowering contract. **Adopt z3-primary via the Rust binding** for the proof layer;
**cvc5 as budgeted, encoding-disciplined corroboration at the SMT-LIB process boundary.** The Go
satellites consume core wasm through wazero with the env-shim pattern. What totem still owns:
record grammar + lowering semantics, fact boundary (ast-grep facts as input data), proof-obligation
design, evidence chains, and the gates — exactly the Tenet-5 split the round's scoring frame
predicted.
