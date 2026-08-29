# Spine spike pair — decision report (COMPLETE — all day-14 rows measured; sealed 2026-08-27)

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
   fails OPEN at eval (empty result, no trap). The `patterns_compile` guard + the host's
   empty-result→error-row mapping is a real structural cure, but it fires at ENTRYPOINT
   EVALUATION — evaluation-loud, not compile-loud (codex MATERIAL 1; the earlier "cured in the
   lowering" was one phase too strong). **Production contract — BINDING condition 1 of the
   2026-08-28 conditional adoption word:** certification MUST evaluate every emitted entrypoint
   against a schema-valid sentinel FactBundle BEFORE artifact publication; empty / undefined /
   error / non-object / missing result keys BLOCK the artifact and its certificate; the guard
   lives in the only exported result path; every host retains the failure rule; negative
   conformance fixtures exercise unsupported patterns on all hosts; the certificate chain binds
   source · IR · guarded policy · entrypoint/import manifest · final Wasm hash. With the actuator
   normative, the mechanism is compile-loud at PIPELINE altitude.
2. regorus's regex capability is a property of the CONSUMER's dependency graph (it declares
   `regex` with default-features off; without host-side `unicode-perl`, 10/24 rows error). As a
   reference oracle it must be pinned WITH its feature graph.
3. MSVC: regorus 0.11.0 stock does not build (Spectre-libs build script panic); needs
   `default-features = false`.

### Spike 2 — solver-neutral Z3/cvc5: **PASS** (capability ruling recorded)

| Criterion                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Artifact                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Z3 and cvc5 agree on SAT/UNSAT            | **8/10 decided by both** (O9 z3-only, O10 the deliberate fail-closed timeout — corrected per codex verification; the artifact records `decidedByBoth: false` for both), **zero semantic contradictions**; O9/O10 = explained capability bounds, ruled not-disagreement (`smt/OBLIGATIONS.md` § Ruling)                                                                                                                                                                                                                                                             | `smt/artifacts/obligations-report.json` |
| countermodels stable                      | 14/14 rows byte-stable across two runs per solver                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | same                                    |
| unsat-core/proof material binds the chain | 20 chain rows: obligation→SMT-LIB→evidence sha256; emission byte-deterministic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `smt/artifacts/chains.json`             |
| timeouts fail closed                      | O10 verified: timeout/unknown ⇒ NOT-PROVEN, no pass-through; outer kill backstop                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | report + `smt/src/runner.rs`            |
| static/vendored builds Windows+Linux      | Windows: **z3 binding BUILDS on MSVC** (10/10 obligations via API, all agree with CLI); **cvc5 binding does NOT build** (bindgen libclang + no MSVC import lib in the pinned distribution) → challenger runs at the SMT-LIB process boundary. Linux: **binding arm GREEN in CI** (run 33138382926) — z3 binding builds+runs on BOTH platforms; cvc5 CLI floor green on both; the cvc5 Linux BINDING is UNPROBED (only the CLI ran on Linux — the deposit mail's "builds on neither platform" overstated; measured = Windows binding fails, Linux binding untested) | `smt/` crate, CI                        |

**The adoption-shaping findings:**

1. **D6 encoding sensitivity:** one logically redundant assertion moved cvc5 from 34ms SAT to
   undecided at 300s (z3 indifferent). A lowerer emitting redundant guards makes the challenger
   unusable; encoding discipline is a first-class constraint. Pre-cure specimen committed
   one-command-replayable: `smt/obligations/o07-pre-cure-d6.smt2`. Proof-lowerer implication:
   canonical, deterministic constraint construction (normalized order, implied-guard dedupe, hash
   of the canonical form, a D6-shaped regression); cvc5 timeout/unknown/error = NOT-PROVEN, always.
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

### Enrichment — egg/egglog on DSL→IR normalization: **REJECT — plain typed IR wins** (pre-registered check, mechanically computed)

Soundness held (27/27 claimed equivalences z3-verified UNSAT — 21 evidence-bearing, 6
tautological by the report's own disclosure) and yield technically cleared (one rewrite-earned
merge), but cost failed: 10/167 per-pattern runs stopped at egg's default node limit on AC churn
(concat-assoc 259k firings), the shared e-graph stopped at the node limit too, and 9 of the 19
locally-provable rules fired zero times on the real corpus. The
decisive control: congruence closure + canonical char-class sets ALONE deliver 161 of the 162→160
dedup — e-graph rewriting earned exactly one merge over free hash-consing. Adoption consequence:
build the Spine IR with canonicalizing constructors (n-ary flattened, hash-consed, canonical
classes) and skip the e-graph engine — SCOPED to this V1 corpus and ruleset, with a measured re-open
tripwire: rewrite yield materially exceeding the congruence null without the AC cost; egg's
verified-equivalence HARNESS pattern (egg proposes, Z3 disposes) is the reusable idea. `egg-probe/artifacts/egg-report.json`.

### Enrichment — wasm validation/mutation (wasm-tools 1.258.0): **DONE**

Original artifact validates and matches its committed chain sha exactly. A single-byte corruption
fails validation loudly (`invalid value type at offset 0x64`). A validity-preserving
`wasm-tools mutate --seed 1` mutant PASSES validation but diverges from the chain sha — measured
proof that **the R2 hash chain is the load-bearing defense against artifact substitution;
validation only catches corruption.** `artifacts/wasm-validation-mutation.json`.

### Build matrix: **MEASURED BOTH PLATFORMS — GREEN.** Windows throughout this report; Linux via `spine-spike-linux.yml` run 33138382926, first run fully green: shipped runtime RE-DERIVED on Linux (line-ending axis exercised), OPA differential, SMT CLI floor, z3 binding arm, wazero probe — all pass; artifacts uploaded.

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

## Ruling of record (2026-08-28) + codex verification fold

Strategy-codex independently replayed the deposit at `c7c59334`: **BLOCKING none** — every measured
target choice reproduced. Its 3 MATERIAL + 2 MINOR wording corrections are folded into this
revision (evaluation-loud vs compile-loud + the actuator contract; 8/10; cvc5 Linux-binding
unprobed; the D6 specimen; e-graph scoping). Operator word 2026-08-28: **CONDITIONAL adoption of
the spike targets**, void where either binding condition is unmet — (1) the pre-publication
strictness actuator is normative (Spike-1 hazard 1 above) and is the lane's first slice; (2)
ADR-103 R14's frozen seed-20 trial remains the binding V1 gate (>=15/20 express cleanly; a typed
disposition for every miss) — the 177/226 census is a compilation-target boundary, not corpus
coverage, and lifts no freeze; every inexpressible pattern is typed and routed, none disappears.
Codification: ADR-103 amendment (strategy lane) citing this revision's sha.

## Recommendation (drafted; final after pending rows)

**Adopt the OPA Rego→Wasm compilation-target lane for the Spine's compile+runtime layer** within
the enumerated expressibility bound, with the structural-strictness pattern as a required part of
the lowering contract. **Adopt z3-primary via the Rust binding** for the proof layer;
**cvc5 as budgeted, encoding-disciplined corroboration at the SMT-LIB process boundary.** The Go
satellites consume core wasm through wazero with the env-shim pattern. What totem still owns:
record grammar + lowering semantics, fact boundary (ast-grep facts as input data), proof-obligation
design, evidence chains, and the gates — exactly the Tenet-5 split the round's scoring frame
predicted.

## Errata (2026-08-29)

Two wording-vs-artifact corrections to the sealed record (`mmnto-ai/totem@6a0eb232`), raised by
strategy-claude 2026-08-28T19:55Z while drafting the ADR-103 amendment
(mmnto-ai/totem-strategy#1146, which quotes the artifact figures directly). Neither moves a verdict.

- **egg soundness row** read "tautologies disclosed — 5 real proofs".
  `egg-probe/artifacts/egg-report.json` `criteria.soundness.tautologicalQueries` =
  `{count: 6, nonTautological: 21, of: 27}`; now "21 evidence-bearing, 6 tautological". The "5" was
  propagated from strategy-codex's 0510Z verification prose, not read from the artifact.
- **egg cost row** read "10/167 patterns hit egg's node limit … in BOTH the per-pattern and
  shared-e-graph arms". The 10/167 is the per-pattern arm (`criteria.cost.failedSubCondition`); the
  shared arm records one aggregate stop (`saturation.sharedEGraph.stopReason` =
  `Some(NodeLimit(12884))`) with no per-pattern rows. Same row: "locally-proven" → "locally
  provable" — DESIGN.md's authoring constraint; no per-rule proof artifact exists.
